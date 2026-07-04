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

// @route   GET /api/rooms
// @desc    List all rooms the user has joined or created
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    // Find rooms where participants array contains the user
    const rooms = await Room.find({
      'participants.user': req.user._id,
    })
      .populate('owner', 'displayName email')
      .populate('participants.user', 'displayName avatarColor')
      .sort({ updatedAt: -1 });

    // Format list to show current user's role explicitly
    const formattedRooms = rooms.map(room => {
      const role = getMemberRole(room, req.user._id);
      return {
        id: room._id,
        uuid: room.uuid,
        name: room.name,
        isClosed: room.isClosed,
        owner: room.owner,
        myRole: role,
        participantCount: room.participants.length,
        updatedAt: room.updatedAt,
      };
    });

    res.json(formattedRooms);
  } catch (error) {
    console.error('List rooms error:', error);
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

module.exports = router;
