const mongoose = require("mongoose");

const chatRoomSchema = new mongoose.Schema(
  {
    name: String,
    subject: String,
    onlineCount: Number
  },
  { timestamps: true }
);

module.exports = mongoose.models.ChatRoom || mongoose.model("ChatRoom", chatRoomSchema);
