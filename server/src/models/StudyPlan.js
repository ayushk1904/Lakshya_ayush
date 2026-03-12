require("dotenv").config();

const mongoose = require("mongoose");

const studyPlanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    studyDate: String,
    syllabusName: String,
    studyWindow: {
      startTime: String,
      endTime: String,
      breakMinutes: Number,
      reminderLeadMinutes: Number
    },
    summary: {
      totalSessions: Number,
      totalMinutes: Number,
      focusMessage: String
    },
    studyProgress: [{ name: String, value: Number }],
    sessions: [
      {
        id: String,
        subject: String,
        chapter: String,
        topic: String,
        durationMinutes: Number,
        priority: String,
        startAt: String,
        endAt: String,
        reminderAt: String,
        reminderLeadMinutes: Number,
        time: String,
        task: String,
        tag: String,
        reminderText: String
      }
    ],
    todayPlan: [{ time: String, task: String, tag: String, reminderAt: String, reminderText: String }],
    coach: {
      summary: String,
      voicePrompt: String,
      roadmap: [{ time: String, task: String, note: String }]
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.StudyPlan || mongoose.model("StudyPlan", studyPlanSchema);
