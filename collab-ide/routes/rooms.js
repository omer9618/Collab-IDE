const express = require('express');
const crypto = require('crypto');
const Room = require('../models/Room');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helper to check user membership and get their role in the room
function getMemberRole(room, userId) {
  const member = room.participants.find(p => {
    const pUserId = (p.user && p.user._id) ? p.user._id.toString() : (p.user ? p.user.toString() : '');
    return pUserId === userId.toString();
  });
  return member ? member.role : null;
}

// @route   POST /api/rooms
// @desc    Create a new room
// @access  Private
router.post('/', protect, async (req, res) => {
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

// Helper: live online userIds for a room, sourced from the WebSocket server (FR-14).
// Returns an empty Set when the WS layer has not registered its hook yet, so the
// dashboard degrades to "0 online" rather than failing.
function getOnlineUserIds(roomUuid, presenceMap) {
  if (!presenceMap) return new Set();
  return presenceMap.get(roomUuid) || new Set();
}

// @route   GET /api/rooms
// @desc    List all rooms the user has joined or created (FR-14)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    // Find rooms where participants array contains the user
    const rooms = await Room.find({
      'participants.user': req.user._id,
    })
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
        // FR-14: how many members are connected right now, not how many joined
        onlineCount: onlineUserIds.size,
        // Legacy rooms predate lastActiveAt — fall back to updatedAt
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

// @route   GET /api/rooms/presence
// @desc    Lightweight online-count poll for the dashboard (FR-14).
//          Returns only counts, so the client can refresh presence every few
//          seconds without re-fetching full room payloads.
// @access  Private
// NOTE: must stay declared above GET /:uuid, otherwise Express matches
//       "presence" as a room UUID.
router.get('/presence', protect, async (req, res) => {
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

// @route   GET /api/rooms/:uuid
// @desc    Get details of a specific room (must be a member)
// @access  Private
router.get('/:uuid', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid })
      .populate('owner', 'displayName email')
      .populate('participants.user', 'displayName email avatarColor');

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // NFR-25 check: Verify the user is a participant of the room
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

// @route   POST /api/rooms/:uuid/join
// @desc    Join a room via share link
// @access  Private
router.post('/:uuid/join', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.isClosed) {
      return res.status(400).json({ message: 'Room is closed and cannot be joined.' });
    }

    const existingRole = getMemberRole(room, req.user._id);

    if (existingRole) {
      return res.json({ message: 'Already a member', role: existingRole });
    }

    // Add as Viewer by default (FR-11)
    room.participants.push({
      user: req.user._id,
      role: 'Viewer',
    });

    await room.save();

    // Trigger role broadcast if the WebSocket server logic has hooks for it
    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Successfully joined room', role: 'Viewer' });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/rooms/:uuid/roles
// @desc    Update a participant's role (Owner or Room Leader only)
// @access  Private
router.put('/:uuid/roles', protect, async (req, res) => {
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

    if (!isOwner && !isRoomLeader) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner or Room Leader can manage roles.' });
    }

    // 1. Only Owner can assign or remove Room Leader
    if (newRole === 'Room Leader' && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can designate a Room Leader.' });
    }

    // Find the participant to change
    const targetParticipant = room.participants.find(p => p.user.toString() === targetUserId);
    if (!targetParticipant) {
      return res.status(400).json({ message: 'Target user is not a participant in this room' });
    }

    // 2. Prevent modifying Owner's role
    if (targetParticipant.role === 'Owner') {
      return res.status(400).json({ message: 'Owner role cannot be changed' });
    }

    // If changing Room Leader, demote the previous Room Leader (only one allowed at a time)
    if (newRole === 'Room Leader') {
      room.participants.forEach(p => {
        if (p.role === 'Room Leader') {
          p.role = 'Editor'; // Demote to Editor or Viewer (using Editor as default fallback)
        }
      });
    }

    // Update target participant's role
    targetParticipant.role = newRole;
    await room.save();

    // Propagate role changes to in-memory session store atomically (NFR-19)
    if (global.updateClientRoleInMemory) {
      global.updateClientRoleInMemory(room.uuid, targetUserId, newRole);
    }

    // Broadcast update to all room clients
    if (global.broadcastRoomParticipants) {
      global.broadcastRoomParticipants(room.uuid);
    }

    res.json({ message: 'Role updated successfully', participants: room.participants });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/rooms/:uuid/roles/grant-all
// @desc    Grant editor access to all current viewers (Room Leader/Owner only)
// @access  Private
router.post('/:uuid/roles/grant-all', protect, async (req, res) => {
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
        
        // Update in-memory session store
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

// @route   POST /api/rooms/:uuid/roles/revoke-all
// @desc    Revoke editor access from all editors (Room Leader/Owner only)
// @access  Private
router.post('/:uuid/roles/revoke-all', protect, async (req, res) => {
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

    // Demote all Editors (except Owner and Room Leader themselves) back to Viewer
    room.participants.forEach(p => {
      if (p.role === 'Editor') {
        p.role = 'Viewer';
        
        // Update in-memory session store
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

// @route   POST /api/rooms/:uuid/close
// @desc    Close room (read-only) (Owner only)
// @access  Private
router.post('/:uuid/close', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    if (room.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can close the room.' });
    }

    room.isClosed = true;
    await room.save();

    if (global.broadcastToRoom) {
      global.broadcastToRoom(room.uuid, JSON.stringify({ type: 'room_closed' }));
    }

    res.json({ message: 'Room closed successfully', room });
  } catch (error) {
    console.error('Close room error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/rooms/:uuid/open
// @desc    Re-open room (Owner only)
// @access  Private
router.post('/:uuid/open', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
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

// @route   DELETE /api/rooms/:uuid
// @desc    Permanently delete room (Owner only)
// @access  Private
router.delete('/:uuid', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ uuid: req.params.uuid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    if (room.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized. Only the Owner can delete the room.' });
    }

    // Broadcast deletion before actually removing it
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
