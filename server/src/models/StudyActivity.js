const mongoose = require("mongoose");

// One document per logged event. "time" entries are upserted per user/feature/day
// so study minutes accumulate without creating a row per heartbeat.
const studyActivitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["time", "score", "activity"], required: true },
    feature: { type: String, required: true },
    day: { type: String, required: true },
    minutes: { type: Number, default: 0 },
    score: { type: Number, default: null },
    label: { type: String, default: "" }
  },
  { timestamps: true }
);

studyActivitySchema.index({ userId: 1, type: 1, day: 1 });

module.exports = mongoose.models.StudyActivity || mongoose.model("StudyActivity", studyActivitySchema);
