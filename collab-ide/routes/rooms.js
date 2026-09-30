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
      return res.status(400).json({ message: 'Room name is required' });
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
    console.error('Create room error:', error);
    res.status(500).json({ message: 'Server error' });
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
    console.error('List rooms error:', error);
    res.status(500).json({ message: 'Server error' });
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
    console.error('Room presence error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid })
      .populate('owner', 'displayName email')
      .populate('participants.user', 'displayName email avatarColor');

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Security: Verify user is a member of the room before returning project files
    const myRole = getMemberRole(room, req.user._id);
    if (!myRole) {
      return res.status(403).json({ message: 'Access denied. You are not a member of this room.' });
    }

    res.json({
      room,
      myRole,
    });
  } catch (error) {
    console.error('Get room details error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Security: Prevent joining archived or closed rooms
    if (room.isClosed) {
      return res.status(400).json({ message: 'Room is closed and cannot be joined.' });
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
    console.error('Join room error:', error);
    res.status(500).json({ message: 'Server error' });
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
      return res.status(400).json({ message: 'Target user ID and new role are required' });
    }

    if (!['Owner', 'Room Leader', 'Editor', 'Viewer'].includes(newRole)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    if (!requesterRole) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Role-based privilege checks (FR-39 to FR-43)
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    // Security: Only Owner and Room Leader possess role administrative capabilities
    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner or Room Leader can manage roles.' });
    }

    // Security Rule 1: Only the Owner can appoint or reassign the Room Leader
    if (newRole === 'Room Leader' && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can designate a Room Leader.' });
    }

    // Find the participant to change
    const targetParticipant = room.participants.find(p => p.user.toString() === targetUserId);
    if (!targetParticipant) {
      return res.status(400).json({ message: 'Target user is not a participant in this room' });
    }

    // Security Rule 2: Prevent modifying Owner's role to prevent room hijacking
    if (targetParticipant.role === 'Owner') {
      return res.status(400).json({ message: 'Owner role cannot be changed' });
    }

    // Security Rule 3: Single Leader Invariant — demote former Room Leader when a new one is selected
    if (newRole === 'Room Leader') {
      room.participants.forEach(p => {
        if (p.role === 'Room Leader') {
          p.role = 'Editor'; // Demote previous leader back to Editor
        }
      });
    }

    // Update target participant's role
    targetParticipant.role = newRole;
    await room.save();

    // Security: Atomic in-memory synchronization prevents race conditions on open WebSockets (NFR-19)
    if (global.updateClientRoleInMemory) {
      global.updateClientRoleInMemory(room.uuid, targetUserId, newRole);
    }

    // Broadcast updated roster to all connected room clients
    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Role updated successfully', participants: room.participants });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Unauthorized. Only Owner or Room Leader can grant editor access.' });
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
    console.error('Grant all error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const requesterRole = getMemberRole(room, req.user._id);
    const isOwner = requesterRole === 'Owner';
    const isRoomLeader = requesterRole === 'Room Leader';

    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Unauthorized. Only Owner or Room Leader can revoke editor access.' });
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
    console.error('Revoke all error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    // Security: Only Owner can close the room
    if (room.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can close the room.' });
    }

    room.isClosed = true;
    await room.save();

    // Broadcast room_closed signal to all active room clients
    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_closed' }));
    }

    res.json({ message: 'Room closed successfully', room });
  } catch (error) {
    console.error('Close room error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    // Security: Only Owner can reopen the room
    if (room.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can re-open the room.' });
    }

    room.isClosed = false;
    await room.save();

    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_opened' }));
    }

    res.json({ message: 'Room opened successfully', room });
  } catch (error) {
    console.error('Open room error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    // Security: Only Owner can delete the room
    if (room.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can delete the room.' });
    }

    // Security: Broadcast deletion notice before database removal to terminate open peer sessions
    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_deleted' }));
    }

    await room.deleteOne();

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
