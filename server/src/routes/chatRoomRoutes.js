const express = require("express");
const mongoose = require("mongoose");
const ChatRoom = require("../models/ChatRoom");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { chatRooms, messages } = require("../utils/mockData");

const router = express.Router();

router.use(authMiddleware);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function serializeRoom(room) {
  return {
    _id: room._id,
    name: room.name,
    subject: room.subject,
    onlineCount: Array.isArray(room.members) ? room.members.filter((member) => member.status === "online").length : 0,
    members: room.members || [],
    invites: room.invites || []
  };
}

async function ensurePersonalRoom(user) {
  let room = await ChatRoom.findOne({ "members.email": user.email }).sort({ createdAt: -1 });

  if (!room) {
    room = await ChatRoom.create({
      name: `${user.name}'s Study Room`,
      subject: "General",
      members: [
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          status: "online",
          role: "owner"
        }
      ]
    });
  }

  return room;
}

async function loadAuthorizedRoom(roomId, user) {
  const room = await ChatRoom.findById(roomId);

  if (!room) {
    return null;
  }

  const isMember = room.members.some((member) => member.email === user.email);
  if (!isMember) {
    return false;
  }

  return room;
}

router.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ rooms: chatRooms });
  }

  await ensurePersonalRoom(req.user);
  const rooms = await ChatRoom.find({ "members.email": req.user.email }).sort({ createdAt: -1 });
  return res.json({ rooms: rooms.map(serializeRoom) });
});

router.get("/:roomId/messages", async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    const room = await loadAuthorizedRoom(req.params.roomId, req.user);

    if (room === null) {
      return res.status(404).json({ message: "Study room not found" });
    }

    if (room === false) {
      return res.status(403).json({ message: "You do not have access to this study room" });
    }

    const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
    return res.json({ room: serializeRoom(room), messages: roomMessages });
  }

  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.json({ room: chatRooms.find((room) => room._id === req.params.roomId) || chatRooms[0], messages: roomMessages });
});

router.post("/:roomId/messages", async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    const room = await loadAuthorizedRoom(req.params.roomId, req.user);

    if (room === null) {
      return res.status(404).json({ message: "Study room not found" });
    }

    if (room === false) {
      return res.status(403).json({ message: "You do not have access to this study room" });
    }
  }

  const newMessage = {
    _id: `m-${Date.now()}`,
    roomId: req.params.roomId,
    user: { name: req.user.name || "Student", email: req.user.email },
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    text: req.body.text
  };

  messages.push(newMessage);
  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.status(201).json({ messages: roomMessages });
});

router.post("/:roomId/invitations", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const room = await loadAuthorizedRoom(req.params.roomId, req.user);

  if (room === null) {
    return res.status(404).json({ message: "Study room not found" });
  }

  if (room === false) {
    return res.status(403).json({ message: "You do not have access to this study room" });
  }

  const email = normalizeEmail(req.body.email);
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  if (email === req.user.email) {
    return res.status(400).json({ message: "You are already in this study room" });
  }

  if (room.members.some((member) => member.email === email)) {
    return res.status(400).json({ message: "This email is already in the study room" });
  }

  if (room.invites.some((invite) => invite.email === email && invite.status === "pending")) {
    return res.status(400).json({ message: "An invitation has already been sent to this email" });
  }

  const invitedUser = await User.findOne({ email }).select("name email");
  room.invites.push({
    email,
    invitedName: invitedUser?.name || "",
    invitedByUserId: req.user._id,
    invitedByName: req.user.name,
    status: "pending"
  });
  await room.save();

  return res.status(201).json({
    room: serializeRoom(room),
    invitedUser: invitedUser ? { name: invitedUser.name, email: invitedUser.email } : null
  });
});

module.exports = router;
