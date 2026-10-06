/**
 * @file routes/rooms.js
 * @module routes/rooms
 * @description Room management, collaboration membership, and role-based access control (RBAC).
 * 
 * Implements:
 * - Room creation, listing, search, and presence querying (FR-10, FR-14)
 * - Collaborative role hierarchy enforcement: Owner > Room Leader > Editor > Viewer (FR-39 – FR-43)
 * - Atomic role updates synchronized with active WebSocket sessions (NFR-19, NFR-25)
 * - Room lifecycle controls (Close, Reopen, Delete) (FR-42, FR-43)
 */

const express = require('express');
const crypto = require('crypto');
const Room = require('../models/Room');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { sendPlainEnglishError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Resolves a user's collaborative role within a specific room.
 *
 * SECURITY REASONING:
 * Inspects the authoritative `participants` subdocument on the MongoDB Room model.
 * Client-reported roles in request bodies or query params are NEVER trusted.
 *
 * @function getMemberRole
 * @param {import('../models/Room').RoomDocument} room - Mongoose room document
 * @param {string|import('mongoose').Types.ObjectId} userId - User ID to look up
 * @returns {string|null} Resolved role ('Owner' | 'Room Leader' | 'Editor' | 'Viewer' | null)
 */
function getMemberRole(room, userId) {
  const member = room.participants.find(p => {
    const pUserId = (p.user && p.user._id) ? p.user._id.toString() : (p.user ? p.user.toString() : '');
    return pUserId === userId.toString();
  });
  return member ? member.role : null;
}

/**
 * Resolves set of online user IDs currently connected to a room via WebSockets (FR-14).
 *
 * @function getOnlineUserIds
 * @param {string} roomUuid - Target room UUID
 * @param {Map<string, Set<string>>|null} presenceMap - In-memory presence map from server.js
 * @returns {Set<string>} Set of online user IDs
 */
function getOnlineUserIds(roomUuid, presenceMap) {
  if (!presenceMap) return new Set();
  return presenceMap.get(roomUuid) || new Set();
}

/**
 * @route   POST /api/rooms
 * @desc    Create a new collaborative room. Creator is automatically designated as Owner.
 * @access  Private (Authenticated users only)
 * 
 * SECURITY REASONING:
 * Automatically seeds the creator with the 'Owner' role, giving them exclusive administrative
 * sovereignty over lifecycle controls (room closure, room deletion, leader appointment).
 */
router.post('/', protect, apiLimiter, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Room name is required. Please provide a name for your workspace.' });
    }

    const uuid = crypto.randomUUID();
    const newRoom = new Room({
      name,
      uuid,
      owner: req.user._id,
      participants: [
        {
          user: req.user._id,
          role: 'Owner',
        },
      ],
      files: [
        {
          name: 'main.js',
          content: `// Welcome to CollabIDE room: ${name}\n\nfunction greet() {\n  console.log("Hello, world!");\n}\n\ngreet();\n`,
        },
        {
          name: 'README.md',
          content: `# ${name}\n\nCollaborative room created by ${req.user.displayName}.\n`,
        },
      ],
    });

    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while creating your workspace room. Please try again.');
  }
});

/**
 * @route   GET /api/rooms
 * @desc    List all rooms the authenticated user has joined or created (FR-14).
 * @access  Private
 * 
 * SECURITY REASONING:
 * Scoped strictly to rooms where `participants.user` contains `req.user._id`. Users cannot
 * enumerate or discover rooms they have not been explicitly invited or joined to.
 */
router.get('/', protect, apiLimiter, async (req, res) => {
  try {
    const { search } = req.query;
    const query = {
      'participants.user': req.user._id,
    };

    // Security: Sanitize user search input to prevent ReDoS (Regular Expression Denial of Service)
    if (search && search.trim()) {
      const sanitized = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: sanitized, $options: 'i' } },
        { uuid: { $regex: sanitized, $options: 'i' } },
      ];
    }

    // Find rooms where participants array contains the user
    const rooms = await Room.find(query)
      .populate('owner', 'displayName email')
      .populate('participants.user', 'displayName avatarColor')
      .sort({ lastActiveAt: -1, updatedAt: -1 });

    // Single presence snapshot reused across every room in this response
    const presenceMap = global.getRoomPresence ? global.getRoomPresence() : null;

    // Format list to show current user's role explicitly
    const formattedRooms = rooms.map(room => {
      const role = getMemberRole(room, req.user._id);
      const onlineUserIds = getOnlineUserIds(room.uuid, presenceMap);

      return {
        id: room._id,
        uuid: room.uuid,
        name: room.name,
        isClosed: room.isClosed,
        owner: room.owner,
        myRole: role,
        participantCount: room.participants.length,
        onlineCount: onlineUserIds.size,
        lastActiveAt: room.lastActiveAt || room.updatedAt,
        updatedAt: room.updatedAt,
        files: room.files ? room.files.map(f => f.name) : [],
        participants: room.participants.map(p => ({
          userId: p.user && p.user._id ? p.user._id : null,
          displayName: p.user && p.user.displayName ? p.user.displayName : 'Unknown',
          avatarColor: p.user && p.user.avatarColor ? p.user.avatarColor : '#1a73e8',
          role: p.role,
          isOnline: p.user && p.user._id
            ? onlineUserIds.has(p.user._id.toString())
            : false,
        })),
      };
    });

    res.json(formattedRooms);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while loading your rooms. Please try again.');
  }
});

/**
 * @route   GET /api/rooms/presence
 * @desc    Lightweight online-count poll for the dashboard (FR-14).
 * @access  Private
 */
router.get('/presence', protect, apiLimiter, async (req, res) => {
  try {
    const rooms = await Room.find({ 'participants.user': req.user._id })
      .select('uuid lastActiveAt updatedAt')
      .lean();

    const presenceMap = global.getRoomPresence ? global.getRoomPresence() : null;

    const presence = {};
    rooms.forEach(room => {
      presence[room.uuid] = {
        onlineCount: getOnlineUserIds(room.uuid, presenceMap).size,
        lastActiveAt: room.lastActiveAt || room.updatedAt,
      };
    });

    res.json({ presence });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while checking room presence. Please try again.');
  }
});

/**
 * @route   GET /api/rooms/:uuid
 * @desc    Retrieve details and files of a specific room.
 * @access  Private
 * 
 * SECURITY REASONING & ROLE ENFORCEMENT (NFR-25):
 * Membership Guard: Queries the database and evaluates `getMemberRole`. If the requesting
 * user is not an active participant in `room.participants`, access is denied with HTTP 403 Forbidden.
 * This prevents unauthorized token holders from accessing room source code or metadata.
 */
router.get('/:uuid', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) {
      return res.status(404).json({ message: 'The requested room could not be found.' });
    }

    const room = await Room.findOne({ 
      uuid: req.params.uuid, 
      'participants.user': req.user._id 
    })
      .populate('owner', 'displayName email')
      .populate('participants.user', 'displayName email avatarColor');

    if (!room) {
      return res.status(403).json({ message: 'You do not have access to this room. Please request an invite to join.' });
    }

    // Security: Extract role from the safely fetched document
    const myRole = getMemberRole(room, req.user._id);

    res.json({
      room,
      myRole,
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while loading room details. Please try again.');
  }
});

/**
 * @route   POST /api/rooms/:uuid/join
 * @desc    Join a room via UUID invite link (FR-11).
 * @access  Private
 * 
 * SECURITY REASONING & ROLE ENFORCEMENT:
 * 1. Closed Room Barrier: If `room.isClosed` is true, joining is blocked with HTTP 400.
 * 2. Default Least-Privilege (FR-11): New participants are enrolled strictly with the
 *    'Viewer' role. They cannot modify files or execute code until promoted by an Owner/Leader.
 * 3. Idempotency: Existing members retain their current role without duplication.
 */
router.post('/:uuid/join', protect, apiLimiter, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid }).select('-files');

    if (!room) {
      return res.status(404).json({ message: 'The requested room could not be found.' });
    }

    // Security: Prevent joining archived or closed rooms
    if (room.isClosed) {
      return res.status(400).json({ message: 'This room is closed and is no longer accepting new participants.' });
    }

    const existingRole = getMemberRole(room, req.user._id);

    if (existingRole) {
      return res.json({ message: 'Already a member', role: existingRole });
    }

    // Security: Default new joiners to Viewer to prevent immediate tampering (least privilege)
    room.participants.push({
      user: req.user._id,
      role: 'Viewer',
    });

    await room.save();

    // Broadcast participant list update to active room connections
    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Successfully joined room', role: 'Viewer' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while joining the room. Please try again.');
  }
});

/**
 * @route   PUT /api/rooms/:uuid/roles
 * @desc    Update a participant's collaborative role (FR-39 – FR-43).
 * @access  Private (Owner or Room Leader only)
 * 
 * SECURITY REASONING & HIERARCHICAL ROLE GOVERNANCE:
 * 1. Authority Hierarchy: Only an Owner or designated Room Leader can modify participant roles.
 * 2. Leader Protection: Only the Owner can designate a new Room Leader. A Room Leader CANNOT
 *    appoint other Room Leaders, preventing unauthorized lateral privilege escalation.
 * 3. Single Leader Invariant: Only one active Room Leader can exist at a time. Promoting a user
 *    to Room Leader automatically demotes the previous Room Leader to Editor.
 * 4. Owner Immutability: An Owner's role cannot be demoted, revoked, or reassigned by a Room Leader.
 * 5. Atomic In-Memory Sync (NFR-19): When a participant is demoted (e.g. Editor -> Viewer),
 *    `global.updateClientRoleInMemory` immediately updates their active WebSocket session state,
 *    preventing window-of-vulnerability file edits through established TCP sockets.
 */
router.put('/:uuid/roles', protect, apiLimiter, async (req, res) => {
  try {
    const { targetUserId, newRole } = req.body;

    if (!targetUserId || !newRole) {
      return res.status(400).json({ message: 'Both the participant and the new role must be specified.' });
    }

    if (!['Owner', 'Room Leader', 'Editor', 'Viewer'].includes(newRole)) {
      return res.status(400).json({ message: 'The specified role is invalid. Allowed roles are: Owner, Room Leader, Editor, or Viewer.' });
    }

    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });

    const room = await Room.findOne({ uuid: req.params.uuid, 'participants.user': req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'You do not have permission to view or manage roles in this room.' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    if (!requesterRole) {
      return res.status(403).json({ message: 'You do not have permission to view or manage roles in this room.' });
    }

    // Role-based privilege checks (FR-39 to FR-43)
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    // Security: Only Owner and Room Leader possess role administrative capabilities
    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Only the room Owner or Room Leader can change participant roles.' });
    }

    // Security Rule 1: Only the Owner can appoint or reassign the Room Leader
    if (newRole === 'Room Leader' && !isOwner) {
      return res.status(403).json({ message: 'Only the room Owner can assign the Room Leader role.' });
    }

    // Find the participant to change
    const targetParticipant = room.participants.find(p => p.user.toString() === targetUserId);
    if (!targetParticipant) {
      return res.status(400).json({ message: 'The selected user is not a participant in this room.' });
    }

    // Security Rule 2: Prevent modifying Owner's role to prevent room hijacking
    if (targetParticipant.role === 'Owner') {
      return res.status(400).json({ message: "The room Owner's role cannot be changed." });
    }

    // Security Rule 3: Single Leader Invariant — demote former Room Leader when a new one is selected
    if (newRole === 'Room Leader') {
      room.participants.forEach(p => {
        if (p.role === 'Room Leader') {
          p.role = 'Editor'; // Demote previous leader back to Editor
          if (global.updateClientRoleInMemory) {
            global.updateClientRoleInMemory(room.uuid, p.user.toString(), 'Editor');
          }
        }
      });
    }

    // Update target participant's role
    targetParticipant.role = newRole;
    
    // Security: Atomic in-memory synchronization prevents race conditions on open WebSockets (NFR-19)
    // Must be updated atomically before DB save and broadcast
    if (global.updateClientRoleInMemory) {
      global.updateClientRoleInMemory(room.uuid, targetUserId, newRole);
    }

    await room.save();

    // Broadcast updated roster to all connected room clients
    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Role updated successfully', participants: room.participants });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while updating the participant role. Please try again.');
  }
});

/**
 * @route   POST /api/rooms/:uuid/roles/grant-all
 * @desc    Grant editor access to all current viewers in the room (FR-40).
 * @access  Private (Owner or Room Leader only)
 * 
 * SECURITY REASONING:
 * Batch operation restricted to Owner and Room Leader. Synchronizes changes directly
 * to active WebSocket sessions in memory to allow immediate collaborative editing.
 */
router.post('/:uuid/roles/grant-all', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });

    const room = await Room.findOne({ uuid: req.params.uuid, 'participants.user': req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'Only the room Owner or Room Leader can grant editor permissions.' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Only the room Owner or Room Leader can grant editor permissions.' });
    }

    // Atomically promote all current Viewers to Editors
    room.participants.forEach(p => {
      if (p.role === 'Viewer') {
        p.role = 'Editor';
        
        // Security: Synchronize in-memory WebSocket permissions immediately (NFR-19)
        if (global.updateClientRoleInMemory) {
          global.updateClientRoleInMemory(room.uuid, p.user.toString(), 'Editor');
        }
      }
    });

    await room.save();

    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Granted editor access to all viewers', participants: room.participants });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while granting editor permissions. Please try again.');
  }
});

/**
 * @route   POST /api/rooms/:uuid/roles/revoke-all
 * @desc    Revoke editor access from all current editors (FR-41).
 * @access  Private (Owner or Room Leader only)
 * 
 * SECURITY REASONING:
 * Demotes Editors back to Viewers, but preserves Owner and Room Leader roles intact.
 * Instantly shuts off editing capabilities on active WebSockets via `updateClientRoleInMemory`.
 */
router.post('/:uuid/roles/revoke-all', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });

    const room = await Room.findOne({ uuid: req.params.uuid, 'participants.user': req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'Only the room Owner or Room Leader can revoke editor permissions.' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Only the room Owner or Room Leader can revoke editor permissions.' });
    }

    // Demote all Editors back to Viewer (preserving Owner and Room Leader)
    room.participants.forEach(p => {
      if (p.role === 'Editor') {
        p.role = 'Viewer';
        
        // Security: Revoke write permissions immediately across active WebSockets
        if (global.updateClientRoleInMemory) {
          global.updateClientRoleInMemory(room.uuid, p.user.toString(), 'Viewer');
        }
      }
    });

    await room.save();

    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Revoked editor access from all editors', participants: room.participants });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while revoking editor permissions. Please try again.');
  }
});

/**
 * @route   POST /api/rooms/:uuid/close
 * @desc    Close room to make it read-only for all participants (FR-42).
 * @access  Private (Owner only)
 * 
 * SECURITY REASONING:
 * Restricting room closure strictly to the room Owner prevents malicious collaborators or
 * temporary leaders from freezing project progress. Emits `room_closed` event to all clients.
 */
router.post('/:uuid/close', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });
    
    // Security: Only Owner can close the room, enforced at DB level
    const room = await Room.findOne({ uuid: req.params.uuid, owner: req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'Only the room Owner can close this room.' });
    }

    room.isClosed = true;
    await room.save();

    // Broadcast room_closed signal to all active room clients
    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_closed' }));
    }

    res.json({ message: 'Room closed successfully', room });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while closing the room. Please try again.');
  }
});

/**
 * @route   POST /api/rooms/:uuid/open
 * @desc    Re-open a closed room to resume collaborative editing (FR-42).
 * @access  Private (Owner only)
 * 
 * SECURITY REASONING:
 * Strictly restricted to Owner. Emits `room_opened` broadcast allowing editors to resume editing.
 */
router.post('/:uuid/open', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });
    
    // Security: Only Owner can reopen the room, enforced at DB level
    const room = await Room.findOne({ uuid: req.params.uuid, owner: req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'Only the room Owner can re-open this room.' });
    }

    room.isClosed = false;
    await room.save();

    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_opened' }));
    }

    res.json({ message: 'Room opened successfully', room });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while opening the room. Please try again.');
  }
});

/**
 * @route   DELETE /api/rooms/:uuid
 * @desc    Permanently delete a room and its document history (FR-43).
 * @access  Private (Owner only)
 * 
 * SECURITY REASONING:
 * Permanent destructive deletion is reserved exclusively for the Owner. Dispatches a `room_deleted`
 * broadcast to all connected WebSocket clients before database removal so peer browsers clean up
 * their editor state and navigate back to the dashboard immediately.
 */
router.delete('/:uuid', protect, apiLimiter, async (req, res) => {
  try {
    const roomExists = await Room.exists({ uuid: req.params.uuid });
    if (!roomExists) return res.status(404).json({ message: 'The requested room could not be found.' });
    
    // Security: Only Owner can delete the room, enforced at DB level
    const room = await Room.findOne({ uuid: req.params.uuid, owner: req.user._id }).select('-files');
    if (!room) {
      return res.status(403).json({ message: 'Only the room Owner can delete this room.' });
    }

    // Security: Broadcast deletion notice before database removal to terminate open peer sessions
    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_deleted' }));
    }

    await room.deleteOne();

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while deleting the room. Please try again.');
  }
});

module.exports = router;
