const mongoose = require("mongoose");

const roomMemberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: ["online", "away"], default: "online" },
    role: { type: String, enum: ["owner", "member"], default: "member" }
  },
  { _id: false }
);

const roomInviteSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    invitedName: { type: String, default: "", trim: true },
    invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    invitedByName: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending"], default: "pending" },
    invitedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const chatRoomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, default: "General", trim: true },
    onlineCount: { type: Number, default: 0 },
    members: { type: [roomMemberSchema], default: [] },
    invites: { type: [roomInviteSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.models.ChatRoom || mongoose.model("ChatRoom", chatRoomSchema);
