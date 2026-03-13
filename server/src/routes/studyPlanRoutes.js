// routes/studyPlanRoutes.js
const express = require("express");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const StudyPlan = require("../models/StudyPlan"); // adjust path if different

const router = express.Router();

// File upload in memory
const upload = multer({ storage: multer.memoryStorage() });

function inferSubject(line) {
  const normalized = line.toLowerCase();

  if (/(algebra|calculus|geometry|trigonometry|mathematics|math)/.test(normalized)) {
    return "Mathematics";
  }

  if (/(physics|motion|force|energy|electric|magnet|wave)/.test(normalized)) {
    return "Physics";
  }

  if (/(chemistry|atom|molecule|reaction|acid|base|organic)/.test(normalized)) {
    return "Chemistry";
  }

  if (/(biology|cell|genetics|human body|ecosystem|plant|animal)/.test(normalized)) {
    return "Biology";
  }

  return "General";
}

function topicLineFromText(line, index) {
  const cleanLine = line.replace(/\s+/g, " ").trim();
  const subject = inferSubject(cleanLine);
  const chapter = `Chapter ${index + 1}`;
  const topic = cleanLine.slice(0, 80);
  const minutes = cleanLine.length > 90 ? 90 : cleanLine.length > 45 ? 60 : 45;
  const priority = index < 3 ? "high" : index < 7 ? "medium" : "low";

  return `${subject} | ${chapter} | ${topic} | ${minutes} | ${priority}`;
}

function extractTopicLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => /[a-zA-Z]/.test(line))
    .filter((line) => !/^page\s+\d+/i.test(line))
    .slice(0, 12)
    .map(topicLineFromText);
}

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

// Route 1: upload PDF and turn extracted text into topic lines without an AI dependency
router.post("/from-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const text = pdfData.text || "";
    const topicLines = extractTopicLines(text);

    if (!topicLines.length) {
      return res.status(400).json({ error: "Could not extract usable study topics from this PDF" });
    }

    return res.json({ topicsText: topicLines.join("\n") });
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
