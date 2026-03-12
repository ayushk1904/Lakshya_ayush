const mongoose = require("mongoose");

const examSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: String,
    date: String,
    count: String,
    mode: String,
    status: { type: String, default: "scheduled" },
    attentionScore: { type: Number, default: 92 }
  },
  { timestamps: true }
);

module.exports = mongoose.models.ExamSession || mongoose.model("ExamSession", examSessionSchema);
