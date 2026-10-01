/**
 * @file scripts/migrate_encryption.js
 * @description In-Place Database Migration Utility for NFR-22: Sensitive Field Encryption at Rest.
 *
 * Scans MongoDB collections for unencrypted legacy fields:
 * - User: `email`, `pendingEmail` -> Encrypt with AES-256-GCM and populate `emailHash`, `pendingEmailHash`
 * - IpBlock: `ip` -> Encrypt with AES-256-GCM and populate `ipHash`
 * - RefreshToken: `deviceInfo` -> Encrypt with AES-256-GCM
 *
 * Usage:
 *   node scripts/migrate_encryption.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { encrypt, isEncrypted, hashBlindIndex } = require('../utils/encryption');

async function migrateCollections() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI not defined in environment.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.\n');

  const db = mongoose.connection.db;

  // ── 1. Migrate Users Collection ───────────────────────────────────────────
  console.log('--- Migrating Users (email, pendingEmail) ---');
  const usersCollection = db.collection('users');
  const usersCursor = usersCollection.find({});
  let usersMigrated = 0;
  let usersTotal = 0;

  while (await usersCursor.hasNext()) {
    const userDoc = await usersCursor.next();
    usersTotal++;
    const updates = {};

    if (userDoc.email && !isEncrypted(userDoc.email)) {
      updates.email = encrypt(userDoc.email);
      updates.emailHash = hashBlindIndex(userDoc.email);
    } else if (userDoc.email && isEncrypted(userDoc.email) && !userDoc.emailHash) {
      // Missing index hash for already encrypted record
      const { decrypt } = require('../utils/encryption');
      updates.emailHash = hashBlindIndex(decrypt(userDoc.email));
    }

    if (userDoc.pendingEmail && !isEncrypted(userDoc.pendingEmail)) {
      updates.pendingEmail = encrypt(userDoc.pendingEmail);
      updates.pendingEmailHash = hashBlindIndex(userDoc.pendingEmail);
    }

    if (Object.keys(updates).length > 0) {
      await usersCollection.updateOne({ _id: userDoc._id }, { $set: updates });
      usersMigrated++;
    }
  }
  console.log(`Users checked: ${usersTotal}, migrated to AES-256-GCM: ${usersMigrated}`);

  // ── 2. Migrate IpBlocks Collection ─────────────────────────────────────────
  console.log('\n--- Migrating IpBlocks (ip) ---');
  const ipBlocksCollection = db.collection('ipblocks');
  const ipCursor = ipBlocksCollection.find({});
  let ipMigrated = 0;
  let ipTotal = 0;

  while (await ipCursor.hasNext()) {
    const ipDoc = await ipCursor.next();
    ipTotal++;
    const updates = {};

    if (ipDoc.ip && !isEncrypted(ipDoc.ip)) {
      updates.ip = encrypt(ipDoc.ip);
      updates.ipHash = hashBlindIndex(ipDoc.ip);
    } else if (ipDoc.ip && isEncrypted(ipDoc.ip) && !ipDoc.ipHash) {
      const { decrypt } = require('../utils/encryption');
      updates.ipHash = hashBlindIndex(decrypt(ipDoc.ip));
    }

    if (Object.keys(updates).length > 0) {
      await ipBlocksCollection.updateOne({ _id: ipDoc._id }, { $set: updates });
      ipMigrated++;
    }
  }
  console.log(`IpBlocks checked: ${ipTotal}, migrated to AES-256-GCM: ${ipMigrated}`);

  // ── 3. Migrate RefreshTokens Collection ───────────────────────────────────
  console.log('\n--- Migrating RefreshTokens (deviceInfo) ---');
  const tokensCollection = db.collection('refreshtokens');
  const tokensCursor = tokensCollection.find({});
  let tokensMigrated = 0;
  let tokensTotal = 0;

  while (await tokensCursor.hasNext()) {
    const tokenDoc = await tokensCursor.next();
    tokensTotal++;
    const updates = {};

    if (tokenDoc.deviceInfo && !isEncrypted(tokenDoc.deviceInfo)) {
      updates.deviceInfo = encrypt(tokenDoc.deviceInfo);
    }

    if (Object.keys(updates).length > 0) {
      await tokensCollection.updateOne({ _id: tokenDoc._id }, { $set: updates });
      tokensMigrated++;
    }
  }
  console.log(`RefreshTokens checked: ${tokensTotal}, migrated to AES-256-GCM: ${tokensMigrated}`);

  console.log('\nMigration completed successfully.');
  await mongoose.disconnect();
}

if (require.main === module) {
  migrateCollections().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
  });
}

module.exports = migrateCollections;
