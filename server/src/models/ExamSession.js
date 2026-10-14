const mongoose = require("mongoose");

const examSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: String,
    date: String,
    count: String,
    mode: String,
    status: { type: String, default: "scheduled" },
    attentionScore: { type: Number, default: 92 },
    marks: { type: Number, default: 80 },
    durationMinutes: { type: Number, default: 60 },
    startAt: Date,
    endsAt: Date,
    endedAt: Date,
    paperIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "PreviousPaper" }],
    generatedTest: { type: String, default: "" },
    callAcceptedAt: Date,
    lastAlert: { type: String, default: "" },
    sharedInviteId: { type: String, default: "", index: true },
    sharedOriginSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ExamSession", default: null },
    sharedRoomId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatRoom", default: null },
    sharedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sharedByName: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.models.ExamSession || mongoose.model("ExamSession", examSessionSchema);
