const mongoose = require("mongoose");

const chatMessageUserSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    role: { type: String, enum: ["owner", "member", "ai"], default: "member" }
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatRoom", required: true, index: true },
    user: { type: chatMessageUserSchema, required: true },
    text: { type: String, trim: true, maxlength: 4000, default: "" },
    kind: { type: String, enum: ["message", "reaction", "practice-invite"], default: "message" },
    attachments: {
      type: [
        new mongoose.Schema(
          {
            type: { type: String, enum: ["image", "file", "document", "link"], required: true },
            name: { type: String, trim: true, default: "" },
            url: { type: String, trim: true, required: true },
            mimeType: { type: String, trim: true, default: "" },
            size: { type: Number, default: 0 }
          },
          { _id: false }
        )
      ],
      default: []
    },
    replyTo: {
      type: new mongoose.Schema(
        {
          messageId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage" },
          userName: { type: String, trim: true, default: "" },
          text: { type: String, trim: true, default: "" }
        },
        { _id: false }
      ),
      default: null
    },
    practiceInvite: {
      type: new mongoose.Schema(
        {
          inviteId: { type: String, required: true, trim: true },
          sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ExamSession", required: true },
          title: { type: String, trim: true, default: "" },
          marks: { type: Number, default: 80 },
          durationMinutes: { type: Number, default: 60 },
          startAt: { type: Date, required: true },
          generatedTest: { type: String, default: "" },
          mode: { type: String, trim: true, default: "focus" },
          invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          invitedByName: { type: String, trim: true, default: "" },
          invitedByEmail: { type: String, trim: true, lowercase: true, default: "" },
          joiners: {
            type: [
              new mongoose.Schema(
                {
                  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                  name: { type: String, trim: true, default: "" },
                  email: { type: String, trim: true, lowercase: true, default: "" },
                  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ExamSession" },
                  joinedAt: { type: Date, default: Date.now }
                },
                { _id: false }
              )
            ],
            default: []
          }
        },
        { _id: false }
      ),
      default: null
    },
    deletedFor: { type: [String], default: [] },
    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);
