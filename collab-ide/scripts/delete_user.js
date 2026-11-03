/**
 * @file scripts/delete_user.js
 * @description Safe CLI utility to delete users and clean up associated records (sessions, room memberships).
 *
 * Accounts for NFR-22 Sensitive Field Encryption at Rest by resolving users
 * through HMAC-SHA256 blind indexing (`emailHash`), MongoDB ObjectId, or displayName.
 * Uses .lean() to prevent hydration decryption errors on legacy-encrypted records.
 *
 * Usage:
 *   node scripts/delete_user.js <email | userId> [email2 | userId2] ...
 *   node scripts/delete_user.js --name "<displayName>"
 *
 * Examples:
 *   node scripts/delete_user.js bss.hamza@gmail.com bcp.hamzat@gmail.com
 *   node scripts/delete_user.js 6a5f7683ef7a3f76c7860b59 6a5fa28ba9560c3b3beaa296 6aad0d2d7a6934d9937ad5cb
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Room = require('../models/Room');
const { hashBlindIndex } = require('../utils/encryption');

async function resolveUser(target) {
  // 1. Try finding by ObjectId
  if (mongoose.Types.ObjectId.isValid(target) && String(new mongoose.Types.ObjectId(target)) === target) {
    const userById = await User.findById(target).lean();
    if (userById) return [userById];
  }

  // 2. Try finding by Email via blind index or plaintext match (.lean() avoids decryption hook error)
  try {
    const emailH = hashBlindIndex(target);
    const userByEmail = await User.findOne({
      $or: [{ emailHash: emailH }, { email: target.toLowerCase().trim() }]
    }).lean();
    if (userByEmail) return [userByEmail];
  } catch (err) {
    // ignore
  }

  return [];
}

async function deleteUserRecord(user) {
  const userId = user._id;
  const displayName = user.displayName;
  console.log(`👤 Processing user: "${displayName}" (ID: ${userId})`);

  // 1. Revoke and delete active sessions / refresh tokens
  const deletedTokens = await RefreshToken.deleteMany({ user: userId });
  console.log(`   - Removed ${deletedTokens.deletedCount} active session/refresh token(s).`);

  // 2. Remove user from room participant lists
  const updatedRooms = await Room.updateMany(
    { 'participants.user': userId },
    { $pull: { participants: { user: userId } } }
  );
  console.log(`   - Removed from ${updatedRooms.modifiedCount} room participant list(s).`);

  // 3. Handle rooms owned by user
  const ownedRooms = await Room.find({ owner: userId });
  if (ownedRooms.length > 0) {
    console.log(`   - Note: User owns ${ownedRooms.length} room(s) [${ownedRooms.map(r => r.name).join(', ')}]. Deleting owned rooms...`);
    await Room.deleteMany({ owner: userId });
    console.log(`   - Deleted ${ownedRooms.length} owned room(s).`);
  }

  // 4. Delete the User record
  await User.deleteOne({ _id: userId });
  console.log(`✅ Successfully deleted user "${displayName}" (ID: ${userId}).\n`);
}

async function run(args) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ Error: MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  if (!args || args.length === 0) {
    console.log('Usage: node scripts/delete_user.js <email | userId> ...');
    console.log('       node scripts/delete_user.js --name "<displayName>"');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB.\n');

  if (args[0] === '--name' && args[1]) {
    const targetName = args.slice(1).join(' ').trim();
    console.log(`🔍 Searching users with displayName: "${targetName}"...`);
    const users = await User.find({ displayName: new RegExp(`^${targetName}$`, 'i') }).lean();
    if (users.length === 0) {
      console.log(`⚠️  No users found matching displayName "${targetName}".`);
    } else {
      console.log(`Found ${users.length} matching user(s).`);
      for (const u of users) {
        await deleteUserRecord(u);
      }
    }
  } else {
    for (const target of args) {
      console.log(`🔍 Searching for user: "${target}"...`);
      const users = await resolveUser(target);
      if (users.length === 0) {
        console.log(`⚠️  User "${target}" not found in database.`);
        continue;
      }
      for (const u of users) {
        await deleteUserRecord(u);
      }
    }
  }

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB. Done.');
}

const args = process.argv.slice(2);
run(args).catch((err) => {
  console.error('❌ Error deleting users:', err);
  process.exit(1);
});
