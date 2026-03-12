// routes/studyPlanRoutes.js
const express = require("express");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const StudyPlan = require("../models/StudyPlan"); // adjust path if different

const router = express.Router();

// File upload in memory
const upload = multer({ storage: multer.memoryStorage() });

// Gemini setup
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY missing. Add it to .env");
}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Build a day schedule: takes topics lines and converts to timed sessions
function buildDaySchedule(studyDate, startTime, breakMinutes, topics, reminderLeadMinutes) {
  let current = new Date(`${studyDate}T${startTime}:00`);

  const sessions = [];
  let totalMinutes = 0;

  topics.forEach((line, index) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) return;

    const [subject, chapter, topic, minutesStr, priorityRaw] = parts;
    const durationMinutes = Number(minutesStr) || 60;
    const priority = (priorityRaw || "medium").toLowerCase();

    const startAt = new Date(current);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    const reminderAt = new Date(
      startAt.getTime() - (reminderLeadMinutes || 5) * 60 * 1000
    );

    const formatTime = (date) =>
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const timeLabel = `${formatTime(startAt)} - ${formatTime(endAt)}`;

    sessions.push({
      id: String(index + 1),
      subject,
      chapter,
      topic,
      durationMinutes,
      priority,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reminderAt: reminderAt.toISOString(),
      reminderLeadMinutes,
      time: timeLabel,
      task: `${subject} - ${chapter}: ${topic}`,
      tag: priority,
      reminderText: `Your ${subject} block is starting. Focus on ${topic}.`
    });

    totalMinutes += durationMinutes;

    // Move current time forward by session duration + break
    current = new Date(endAt.getTime() + (breakMinutes || 10) * 60 * 1000);
  });

  return { sessions, totalMinutes };
}

// Route 1: upload PDF, extract text, ask Gemini to create topic lines
router.post("/from-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const text = pdfData.text || "";

    const prompt = `
You are an AI study planner. The user gives you their syllabus text from a PDF.
Read it and output study topics, one per line, in exactly this format:

Subject | Chapter | Topic | Minutes | Priority

Rules:
- Use simple subject names (Physics, Mathematics, Chemistry, etc.).
- Minutes should be a reasonable focus block (45, 60, or 90).
- Priority must be one of: high, medium, low.
- Do NOT add explanations, bullets, numbering, or extra text.
- Output ONLY the lines in that format.

Syllabus:
"""${text}"""
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const raw = response.text ? response.text() : "";

    return res.json({ topicsText: raw.trim() });
  } catch (err) {
    console.error("from-pdf error:", err);
    return res.status(500).json({ error: "Failed to process PDF" });
  }
});

// Route 2: generate full plan with proper timetable and reminders
router.post("/generate-plan", async (req, res) => {
  try {
    const {
      userId,
      syllabusName,
      studyDate,
      startTime,
      endTime,
      breakMinutes,
      reminderLeadMinutes,
      topicsInput
    } = req.body;

    const topics = (topicsInput || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!topics.length) {
      return res.status(400).json({ error: "No topics provided" });
    }

    const breakMins = Number(breakMinutes) || 10;
    const reminderLead = Number(reminderLeadMinutes) || 5;

    const { sessions, totalMinutes } = buildDaySchedule(
      studyDate,
      startTime,
      breakMins,
      topics,
      reminderLead
    );

    const plan = new StudyPlan({
      userId: userId || null,
      studyDate,
      syllabusName,
      studyWindow: {
        startTime,
        endTime,
        breakMinutes: breakMins,
        reminderLeadMinutes: reminderLead
      },
      summary: {
        totalSessions: sessions.length,
        totalMinutes,
        focusMessage:
          "Start with your first session and follow the timeline to complete your plan."
      },
      studyProgress: [],
      sessions,
      todayPlan: [],
      coach: {
        summary: "",
        voicePrompt: "",
        roadmap: []
      }
    });

    await plan.save();

    return res.json({ plan });
  } catch (err) {
    console.error("generate-plan error:", err);
    return res.status(500).json({ error: "Failed to generate plan" });
  }
});

// Route 3: today's plan (for initial load)
router.get("/today-plan", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const plan = await StudyPlan.findOne({ studyDate: today }).sort({
      createdAt: -1
    });

    if (!plan) {
      return res.json({});
    }

    return res.json(plan);
  } catch (err) {
    console.error("today-plan error:", err);
    return res.status(500).json({ error: "Failed to fetch today's plan" });
  }
});

module.exports = router;
