/**
 * @file services/yjsUpdateGuard.js
 * @module services/yjsUpdateGuard
 * @description Server-side inspection of inbound Yjs updates (FR-34, NFR-18).
 *
 * FR-34 requires that *all* users (Editors and Viewers) can send chat messages. Chat lives in the
 * room's Y.Doc (`${roomUuid}:chat`), so Viewers must be allowed to write to that one shared type
 * while every other type (files, file list) stays read-only for them.
 *
 * Why a dedicated resolver is needed:
 *   In the Yjs binary format only the *first* item inserted into a type carries its parent name.
 *   Every later item (the 2nd chat message, any mid-document text insert) only carries
 *   `origin` / `rightOrigin` IDs pointing at neighbouring items, and deletions are encoded in a
 *   separate delete set with no parent at all. Checking `struct.parent` alone therefore lets
 *   mid-text inserts and all deletions straight through. We resolve each struct's root type by
 *   looking its neighbours up in the server's authoritative Y.Doc (or earlier structs in the same
 *   update), and treat anything unresolvable as untrusted.
 *
 * Complexity per update: O(s + d · log n) where s = structs in the update, d = delete ranges and
 * n = structs stored for the referenced client (binary search via `Y.findIndexSS`). Root-name
 * lookups are memoised per call, so `Y.findRootTypeKey` (O(root types)) runs at most once per type.
 */

const Y = require('yjs');

/** Maximum characters in a single chat message (mirrored in the frontend input `maxLength`). */
const MAX_CHAT_MESSAGE_LENGTH = 2000;
/** Maximum chat messages retained in the persisted room document (oldest are trimmed). */
const MAX_CHAT_HISTORY = 200;
/** Transaction origin used for server-initiated chat trimming so it can be broadcast. */
const CHAT_TRIM_ORIGIN = 'server:chat-trim';

const CHAT_ALLOWED_KEYS = new Set(['userId', 'displayName', 'avatarColor', 'text', 'time', 'ts']);
const MAX_AUX_FIELD_LENGTH = 64;

/**
 * Returns the shared-type key used for a room's chat array.
 * @param {string} roomUuid
 * @returns {string}
 */
function chatTypeName(roomUuid) {
  return `${roomUuid}:chat`;
}

/**
 * Climbs from any (possibly nested) shared type to its root and returns the root key.
 * @param {Y.AbstractType|null|undefined} type
 * @param {Map<Y.AbstractType, string|undefined>} cache
 * @returns {string|undefined}
 */
function rootNameOfType(type, cache) {
  let current = type;
  while (current && current._item) {
    current = current._item.parent;
  }
  if (!current) return undefined;
  if (cache.has(current)) return cache.get(current);
  let name;
  try {
    name = Y.findRootTypeKey(current);
  } catch (_) {
    name = undefined; // Type not registered as a root of this doc
  }
  cache.set(current, name);
  return name;
}

/**
 * Looks up the root type key of an existing item in the server document.
 * @param {Y.Doc} ydoc
 * @param {{client:number, clock:number}} id
 * @param {Map} cache
 * @returns {string|undefined} undefined when the item is unknown to the server
 */
function rootNameOfDocItem(ydoc, id, cache) {
  const store = ydoc.store;
  if (Y.getState(store, id.client) <= id.clock) return undefined;
  let struct;
  try {
    struct = Y.getItem(store, id);
  } catch (_) {
    return undefined;
  }
  if (!struct || !struct.parent) return undefined; // GC structs carry no parent
  return rootNameOfType(struct.parent, cache);
}

/**
 * Resolves the root type key for every struct in a decoded update and identifies deletions that
 * the server has not yet applied.
 *
 * @param {Uint8Array} update - Raw Yjs update (v1 encoding)
 * @param {Y.Doc} ydoc - Authoritative server document (read-only access)
 * @returns {{
 *   items: Array<{ root: string|undefined, content: any, isItem: boolean }>,
 *   newDeleteRoots: Array<string|undefined>,
 *   hasUnknownDeletes: boolean,
 * }}
 */
function inspectUpdate(update, ydoc) {
  const decoded = Y.decodeUpdate(update);
  const typeCache = new Map();
  // Ranges of structs introduced by this very update, per client, for intra-update references.
  const localRanges = new Map();

  const items = decoded.structs.map((struct) => ({
    struct,
    root: undefined,
    resolved: false,
    content: struct.content,
    isItem: struct instanceof Y.Item,
  }));

  const findLocalRoot = (id) => {
    const ranges = localRanges.get(id.client);
    if (!ranges) return { found: false };
    for (const range of ranges) {
      if (id.clock >= range.clock && id.clock < range.clock + range.length) {
        return { found: true, root: range.root };
      }
    }
    return { found: false };
  };

  const resolveId = (id) => {
    const local = findLocalRoot(id);
    if (local.found) return { found: true, root: local.root };
    const root = rootNameOfDocItem(ydoc, id, typeCache);
    return { found: root !== undefined, root };
  };

  // Iterate until no further struct can be resolved (handles out-of-order intra-update references).
  let progress = true;
  while (progress) {
    progress = false;
    for (const entry of items) {
      if (entry.resolved || !entry.isItem) continue;
      const { struct } = entry;
      let result = { found: false, root: undefined };

      if (typeof struct.parent === 'string') {
        result = { found: true, root: struct.parent };
      } else if (struct.parent && typeof struct.parent === 'object' && 'client' in struct.parent) {
        // Parent is a nested type identified by the ID of the item that holds it
        const holder = resolveId(struct.parent);
        result = holder;
      } else if (struct.origin) {
        result = resolveId(struct.origin);
      } else if (struct.rightOrigin) {
        result = resolveId(struct.rightOrigin);
      }

      if (result.found) {
        entry.root = result.root;
        entry.resolved = true;
        progress = true;
        const ranges = localRanges.get(struct.id.client) || [];
        ranges.push({ clock: struct.id.clock, length: struct.length, root: result.root });
        localRanges.set(struct.id.client, ranges);
      }
    }
  }

  // Deletions: only deletions of items the server still considers live are "new".
  const newDeleteRoots = [];
  let hasUnknownDeletes = false;
  for (const [client, ranges] of decoded.ds.clients.entries()) {
    const structs = ydoc.store.clients.get(client);
    const serverState = Y.getState(ydoc.store, client);
    for (const { clock, len } of ranges) {
      const end = clock + len;
      if (!structs || serverState < end) {
        hasUnknownDeletes = true;
      }
      if (!structs || serverState <= clock) continue;
      let index = Y.findIndexSS(structs, clock);
      for (; index < structs.length && structs[index].id.clock < end; index++) {
        const stored = structs[index];
        if (stored.deleted) continue;
        newDeleteRoots.push(stored.parent ? rootNameOfType(stored.parent, typeCache) : undefined);
      }
    }
  }

  return {
    items: items.map(({ root, content, isItem }) => ({ root, content, isItem })),
    newDeleteRoots,
    hasUnknownDeletes,
  };
}

/**
 * Validates a single chat entry against the authenticated socket identity.
 * @param {any} entry
 * @param {{ userId: string, displayName?: string }} identity
 * @returns {string|null} Rejection reason, or null when valid
 */
function validateChatEntry(entry, identity) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'chat entry is not an object';
  for (const key of Object.keys(entry)) {
    if (!CHAT_ALLOWED_KEYS.has(key)) return `unexpected chat field "${key}"`;
  }
  if (entry.userId !== identity.userId) return 'chat userId does not match authenticated user';
  if (typeof entry.displayName !== 'string') return 'chat displayName missing';
  if (identity.displayName !== undefined && entry.displayName !== identity.displayName) {
    return 'chat displayName does not match authenticated user';
  }
  if (typeof entry.text !== 'string') return 'chat text missing';
  const trimmedLength = entry.text.trim().length;
  if (trimmedLength === 0) return 'chat text is empty';
  if (entry.text.length > MAX_CHAT_MESSAGE_LENGTH) return 'chat text exceeds maximum length';
  for (const key of ['avatarColor', 'time']) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > MAX_AUX_FIELD_LENGTH)) {
      return `chat ${key} is invalid`;
    }
  }
  if (entry.ts !== undefined && (typeof entry.ts !== 'number' || !Number.isFinite(entry.ts) || entry.ts <= 0)) {
    return 'chat ts is invalid';
  }
  return null;
}

/**
 * Applies the room's write policy to an inbound update.
 *
 * Policy:
 *  - Chat entries (any role) must be well-formed and bound to the sender's authenticated identity.
 *  - Clients may never delete chat messages (only the server trims history).
 *  - Viewers may only insert chat entries: no other types, no new deletions, nothing unresolvable.
 *  - For Editors, unresolvable `ContentAny` structs are rejected because they could integrate into
 *    the chat array later without validation; unresolvable text structs keep today's behaviour.
 *
 * @param {Uint8Array} update
 * @param {Y.Doc} ydoc
 * @param {{ roomUuid: string, role: string, userId: string, displayName?: string }} context
 * @returns {{ allowed: boolean, reason?: string, touchesChat: boolean }}
 */
function evaluateUpdate(update, ydoc, context) {
  const chatName = chatTypeName(context.roomUuid);
  const isViewer = context.role === 'Viewer';
  const { items, newDeleteRoots, hasUnknownDeletes } = inspectUpdate(update, ydoc);
  let touchesChat = false;

  for (const item of items) {
    if (!item.isItem) {
      if (isViewer) return { allowed: false, reason: 'viewer sent non-item struct', touchesChat };
      continue;
    }
    if (item.root === undefined) {
      if (isViewer) return { allowed: false, reason: 'viewer update target could not be resolved', touchesChat };
      if (item.content instanceof Y.ContentAny) {
        return { allowed: false, reason: 'unresolvable list insert', touchesChat };
      }
      continue;
    }
    if (item.root === chatName) {
      touchesChat = true;
      if (!(item.content instanceof Y.ContentAny)) {
        return { allowed: false, reason: 'chat insert has invalid content type', touchesChat };
      }
      for (const entry of item.content.arr) {
        const reason = validateChatEntry(entry, context);
        if (reason) return { allowed: false, reason, touchesChat };
      }
    } else if (isViewer) {
      return { allowed: false, reason: `viewer attempted to modify "${item.root}"`, touchesChat };
    }
  }

  if (newDeleteRoots.some((root) => root === chatName)) {
    return { allowed: false, reason: 'clients may not delete chat messages', touchesChat };
  }
  if (isViewer && (newDeleteRoots.length > 0 || hasUnknownDeletes)) {
    return { allowed: false, reason: 'viewer attempted to delete content', touchesChat };
  }

  return { allowed: true, touchesChat };
}

/**
 * Trims the chat array to the newest `MAX_CHAT_HISTORY` entries in a server-origin transaction.
 * @param {Y.Doc} ydoc
 * @param {string} roomUuid
 * @param {number} [limit=MAX_CHAT_HISTORY]
 * @returns {number} Number of entries removed
 */
function trimChatHistory(ydoc, roomUuid, limit = MAX_CHAT_HISTORY) {
  const ychat = ydoc.getArray(chatTypeName(roomUuid));
  const excess = ychat.length - limit;
  if (excess <= 0) return 0;
  ydoc.transact(() => {
    ychat.delete(0, excess);
  }, CHAT_TRIM_ORIGIN);
  return excess;
}

module.exports = {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_HISTORY,
  CHAT_TRIM_ORIGIN,
  chatTypeName,
  inspectUpdate,
  validateChatEntry,
  evaluateUpdate,
  trimChatHistory,
};
