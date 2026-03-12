const express = require("express");
const mongoose = require("mongoose");
const ChatRoom = require("../models/ChatRoom");
const authMiddleware = require("../middleware/authMiddleware");
const { chatRooms, messages } = require("../utils/mockData");

const router = express.Router();

router.use(authMiddleware);

router.get("/", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ rooms: chatRooms });
  }

  const rooms = await ChatRoom.find().sort({ createdAt: -1 });
  return res.json({ rooms });
});

router.get("/:roomId/messages", async (req, res) => {
  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.json({ messages: roomMessages });
});

router.post("/:roomId/messages", async (req, res) => {
  const newMessage = {
    _id: `m-${Date.now()}`,
    roomId: req.params.roomId,
    user: { name: req.user.name || "Student" },
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    text: req.body.text
  };

  messages.push(newMessage);
  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.status(201).json({ messages: roomMessages });
});

module.exports = router;
