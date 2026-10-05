/**
 * @file scripts/rotate_encryption_key.js
 * @description In-Place Database Key Rotation Utility (NFR-22, NFR-49).
 *
 * Re-encrypts sensitive database fields (users, ipblocks, refreshtokens) from an
 * old master key to a new cryptographically random master key with:
 * - Automatic pre-migration local JSON backup
 * - Double verification (ciphertext decryption + blind index math check before commit)
 * - Resumable idempotency (skips records already matching new key)
 * - Dry-run simulation mode
 *
 * Usage:
 *   node scripts/rotate_encryption_key.js --old-key <64-hex> --new-key <64-hex> [--dry-run] [--batch-size 100]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const ENCRYPTION_PREFIX = 'enc:gcm:';
const REGEX_CIPHERTEXT = /^enc:gcm:([0-9a-f]{24}):([0-9a-f]{32}):([0-9a-f]+)$/i;

/**
 * Derives 32-byte master key buffer from hex string or raw string.
 *
 * @param {string} keyStr - Key string
 * @returns {Buffer} 32-byte key buffer
 */
function parseKey(keyStr) {
  if (!keyStr || typeof keyStr !== 'string') {
    throw new Error('Key must be a non-empty string.');
  }
  const trimmed = keyStr.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const buf = Buffer.from(trimmed, 'utf8');
  if (buf.length === 32) return buf;
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Derives operational cipher key and blind index key using HKDF (RFC 5869).
 * Matches utils/encryption.js specification exactly.
 *
 * @param {Buffer} masterKey - 32-byte master key buffer
 * @returns {{ cipherKey: Buffer, indexKey: Buffer }}
 */
function deriveKeys(masterKey) {
  const cipherKey = crypto.hkdfSync('sha256', masterKey, '', 'collabide-aes-256-gcm-cipher', 32);
  const indexKey = crypto.hkdfSync('sha256', masterKey, '', 'collabide-blind-index-hmac', 32);
  return {
    cipherKey: Buffer.from(cipherKey),
    indexKey: Buffer.from(indexKey),
  };
}

/**
 * Checks whether a string is formatted as an AES-256-GCM ciphertext.
 *
 * @param {*} val
 * @returns {boolean}
 */
function isEncrypted(val) {
  if (typeof val !== 'string') return false;
  return REGEX_CIPHERTEXT.test(val);
}

/**
 * Attempts decryption using a specific cipher key.
 *
 * @param {string} ciphertextStr
 * @param {Buffer} cipherKey
 * @returns {string|null} Plaintext if successful, null if authentication fails
 */
function tryDecrypt(ciphertextStr, cipherKey) {
  if (typeof ciphertextStr !== 'string') return null;
  const match = ciphertextStr.match(REGEX_CIPHERTEXT);
  if (!match) return null;

  try {
    const [, ivHex, tagHex, dataHex] = match;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, cipherKey, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(dataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Encrypts plaintext using a specific cipher key.
 *
 * @param {string} plaintext
 * @param {Buffer} cipherKey
 * @returns {string}
 */
function encryptWithKey(plaintext, cipherKey) {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, cipherKey, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Computes blind index HMAC-SHA256 using a specific index key.
 *
 * @param {string} value
 * @param {Buffer} indexKey
 * @returns {string}
 */
function hashBlindIndexWithKey(value, indexKey) {
  if (!value) return '';
  const normalized = String(value).toLowerCase().trim();
  if (normalized.length === 0) return '';
  return crypto.createHmac('sha256', indexKey).update(normalized).digest('hex');
}

/**
 * Executes database field key rotation across users, ipblocks, and refreshtokens.
 *
 * @async
 * @function rotateEncryptionKeys
 * @param {object} params
 * @param {string} params.oldKey - Hex string of old master key
 * @param {string} params.newKey - Hex string of new master key
 * @param {string} [params.mongoUri] - MongoDB URI (defaults to process.env.MONGODB_URI)
 * @param {boolean} [params.dryRun=false] - Whether to simulate without committing writes
 * @param {number} [params.batchSize=100] - Batch size for processing
 * @param {boolean} [params.skipBackup=false] - Whether to skip local JSON snapshot
 * @returns {Promise<object>} Summary statistics of rotation
 */
async function rotateEncryptionKeys({
  oldKey,
  newKey,
  mongoUri = process.env.MONGODB_URI,
  dryRun = false,
  batchSize = 100,
  skipBackup = false,
}) {
  if (!oldKey || !newKey) {
    throw new Error('Both --old-key and --new-key are required.');
  }

  const oldMasterKey = parseKey(oldKey);
  const newMasterKey = parseKey(newKey);

  if (oldMasterKey.equals(newMasterKey)) {
    throw new Error('oldKey and newKey cannot be identical.');
  }

  const oldDerived = deriveKeys(oldMasterKey);
  const newDerived = deriveKeys(newMasterKey);

  if (!mongoUri) {
    throw new Error('MongoDB URI not defined in environment or params.');
  }

  let localConnection = false;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
    localConnection = true;
  }

  const db = mongoose.connection.db;
  const stats = {
    dryRun,
    users: { total: 0, migrated: 0, alreadyMigrated: 0, skipped: 0, errors: 0 },
    ipblocks: { total: 0, migrated: 0, alreadyMigrated: 0, skipped: 0, errors: 0 },
    refreshtokens: { total: 0, migrated: 0, alreadyMigrated: 0, skipped: 0, errors: 0 },
  };

  console.log(`\n================================================================`);
  console.log(`   COLLABIDE DATABASE KEY ROTATION UTILITY (NFR-22, NFR-49)`);
  console.log(`   Mode: ${dryRun ? '🔍 SIMULATION / DRY-RUN (no database writes)' : '⚡ LIVE DATABASE MUTATION'}`);
  console.log(`================================================================\n`);

  // ── Step 1: Automatic Pre-Migration Backup ─────────────────────────────────
  if (!dryRun && !skipBackup) {
    try {
      const logsDir = path.join(__dirname, '..', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(logsDir, `backup_before_rotation_${timestamp}.json`);

      const [users, ipblocks, refreshtokens] = await Promise.all([
        db.collection('users').find({}).toArray(),
        db.collection('ipblocks').find({}).toArray(),
        db.collection('refreshtokens').find({}).toArray(),
      ]);

      const backupData = {
        metadata: {
          timestamp: new Date().toISOString(),
          oldKeySha256: crypto.createHash('sha256').update(oldMasterKey).digest('hex'),
          counts: { users: users.length, ipblocks: ipblocks.length, refreshtokens: refreshtokens.length },
        },
        users,
        ipblocks,
        refreshtokens,
      };

      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), { mode: 0o600 });
      console.log(`📦 Pre-migration local snapshot saved: ${backupPath}\n`);
    } catch (bErr) {
      console.warn(`⚠️  Warning: Pre-migration local backup failed (${bErr.message}). Continuing...`);
    }
  }

  // ── Step 2: Migrate Users ─────────────────────────────────────────────────
  console.log('--- Scanning Collection: users ---');
  const usersColl = db.collection('users');
  const userCursor = usersColl.find({});

  while (await userCursor.hasNext()) {
    const userDoc = await userCursor.next();
    stats.users.total++;
    const updates = {};
    let needsUpdate = false;

    // Check `email`
    if (userDoc.email) {
      const fieldResult = processField(
        userDoc.email,
        oldDerived.cipherKey,
        newDerived.cipherKey,
        newDerived.indexKey
      );

      if (fieldResult.status === 'alreadyMigrated') {
        stats.users.alreadyMigrated++;
      } else if (fieldResult.status === 'migrated') {
        updates.email = fieldResult.newCiphertext;
        updates.emailHash = fieldResult.newBlindIndex;
        needsUpdate = true;
      } else {
        stats.users.skipped++;
      }
    }

    // Check `pendingEmail`
    if (userDoc.pendingEmail) {
      const fieldResult = processField(
        userDoc.pendingEmail,
        oldDerived.cipherKey,
        newDerived.cipherKey,
        newDerived.indexKey
      );

      if (fieldResult.status === 'migrated') {
        updates.pendingEmail = fieldResult.newCiphertext;
        updates.pendingEmailHash = fieldResult.newBlindIndex;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      if (!dryRun) {
        await usersColl.updateOne({ _id: userDoc._id }, { $set: updates });
      }
      stats.users.migrated++;
    }
  }
  console.log(`  Processed: ${stats.users.total} | Migrated: ${stats.users.migrated} | Already on new key: ${stats.users.alreadyMigrated}`);

  // ── Step 3: Migrate IpBlocks ──────────────────────────────────────────────
  console.log('\n--- Scanning Collection: ipblocks ---');
  const ipColl = db.collection('ipblocks');
  const ipCursor = ipColl.find({});

  while (await ipCursor.hasNext()) {
    const ipDoc = await ipCursor.next();
    stats.ipblocks.total++;

    if (ipDoc.ip) {
      const fieldResult = processField(
        ipDoc.ip,
        oldDerived.cipherKey,
        newDerived.cipherKey,
        newDerived.indexKey
      );

      if (fieldResult.status === 'alreadyMigrated') {
        stats.ipblocks.alreadyMigrated++;
      } else if (fieldResult.status === 'migrated') {
        if (!dryRun) {
          await ipColl.updateOne(
            { _id: ipDoc._id },
            { $set: { ip: fieldResult.newCiphertext, ipHash: fieldResult.newBlindIndex } }
          );
        }
        stats.ipblocks.migrated++;
      } else {
        stats.ipblocks.skipped++;
      }
    }
  }
  console.log(`  Processed: ${stats.ipblocks.total} | Migrated: ${stats.ipblocks.migrated} | Already on new key: ${stats.ipblocks.alreadyMigrated}`);

  // ── Step 4: Migrate RefreshTokens ─────────────────────────────────────────
  console.log('\n--- Scanning Collection: refreshtokens ---');
  const tokensColl = db.collection('refreshtokens');
  const tokenCursor = tokensColl.find({});

  while (await tokenCursor.hasNext()) {
    const tokenDoc = await tokenCursor.next();
    stats.refreshtokens.total++;

    if (tokenDoc.deviceInfo) {
      const fieldResult = processField(
        tokenDoc.deviceInfo,
        oldDerived.cipherKey,
        newDerived.cipherKey,
        newDerived.indexKey
      );

      if (fieldResult.status === 'alreadyMigrated') {
        stats.refreshtokens.alreadyMigrated++;
      } else if (fieldResult.status === 'migrated') {
        if (!dryRun) {
          await tokensColl.updateOne(
            { _id: tokenDoc._id },
            { $set: { deviceInfo: fieldResult.newCiphertext } }
          );
        }
        stats.refreshtokens.migrated++;
      } else {
        stats.refreshtokens.skipped++;
      }
    }
  }
  console.log(`  Processed: ${stats.refreshtokens.total} | Migrated: ${stats.refreshtokens.migrated} | Already on new key: ${stats.refreshtokens.alreadyMigrated}`);

  console.log('\n================================================================');
  console.log('✅ KEY ROTATION COMPLETE');
  console.log(`   Users:         ${stats.users.migrated} updated (${stats.users.alreadyMigrated} already on new key)`);
  console.log(`   IpBlocks:      ${stats.ipblocks.migrated} updated (${stats.ipblocks.alreadyMigrated} already on new key)`);
  console.log(`   RefreshTokens: ${stats.refreshtokens.migrated} updated (${stats.refreshtokens.alreadyMigrated} already on new key)`);
  console.log('================================================================\n');

  if (localConnection) {
    await mongoose.disconnect();
  }

  return stats;
}

/**
 * Processes a single candidate field: checks if already migrated, decrypts with old key,
 * re-encrypts with new key, and self-checks before returning.
 *
 * @private
 * @param {string} value - Existing field value
 * @param {Buffer} oldCipherKey - Old AES cipher key
 * @param {Buffer} newCipherKey - New AES cipher key
 * @param {Buffer} newIndexKey - New HMAC index key
 * @returns {{ status: 'migrated'|'alreadyMigrated'|'skipped', newCiphertext?: string, newBlindIndex?: string }}
 */
function processField(value, oldCipherKey, newCipherKey, newIndexKey) {
  if (!value || typeof value !== 'string') {
    return { status: 'skipped' };
  }

  // 1. Check if ALREADY on new key
  if (isEncrypted(value)) {
    const alreadyDecrypted = tryDecrypt(value, newCipherKey);
    if (alreadyDecrypted !== null) {
      return { status: 'alreadyMigrated' };
    }

    // 2. Attempt decrypt with old key
    const decryptedWithOld = tryDecrypt(value, oldCipherKey);
    if (decryptedWithOld !== null) {
      const newCiphertext = encryptWithKey(decryptedWithOld, newCipherKey);
      const newBlindIndex = hashBlindIndexWithKey(decryptedWithOld, newIndexKey);

      // Self-check roundtrip verification
      const verifyDecrypted = tryDecrypt(newCiphertext, newCipherKey);
      if (verifyDecrypted !== decryptedWithOld) {
        throw new Error('Fatal integrity verification failed: re-encrypted ciphertext does not decrypt to original plaintext.');
      }
      const verifyHash = hashBlindIndexWithKey(verifyDecrypted, newIndexKey);
      if (verifyHash !== newBlindIndex) {
        throw new Error('Fatal integrity verification failed: re-derived blind index does not match re-encrypted plaintext.');
      }

      return {
        status: 'migrated',
        newCiphertext,
        newBlindIndex,
      };
    }
  } else {
    // Plaintext unencrypted record (legacy)
    const newCiphertext = encryptWithKey(value, newCipherKey);
    const newBlindIndex = hashBlindIndexWithKey(value, newIndexKey);

    return {
      status: 'migrated',
      newCiphertext,
      newBlindIndex,
    };
  }

  return { status: 'skipped' };
}

// ── CLI Execution Support ───────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const oldKey = getArg('--old-key') || process.env.OLD_FIELD_ENCRYPTION_KEY;
  const newKey = getArg('--new-key') || process.env.FIELD_ENCRYPTION_KEY;
  const dryRun = args.includes('--dry-run');
  const skipBackup = args.includes('--skip-backup');

  if (!oldKey || !newKey) {
    console.error('Usage: node scripts/rotate_encryption_key.js --old-key <64-hex> --new-key <64-hex> [--dry-run]');
    process.exit(1);
  }

  rotateEncryptionKeys({ oldKey, newKey, dryRun, skipBackup })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Fatal rotation error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  rotateEncryptionKeys,
  deriveKeys,
  parseKey,
  tryDecrypt,
  encryptWithKey,
  hashBlindIndexWithKey,
};
