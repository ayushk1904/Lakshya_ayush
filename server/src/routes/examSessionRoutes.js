const express = require("express");
const mongoose = require("mongoose");
const ExamSession = require("../models/ExamSession");
const authMiddleware = require("../middleware/authMiddleware");
const { exams } = require("../utils/mockData");

const router = express.Router();

router.use(authMiddleware);

router.get("/upcoming", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ exams });
  }

  const sessions = await ExamSession.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json({ exams: sessions.length ? sessions : exams });
});

router.get("/active", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ session: exams[0] });
  }

  const session = await ExamSession.findOne({ userId: req.user._id, status: "active" }).sort({ createdAt: -1 });
  return res.json({ session: session || exams[0] });
});

router.post("/start", async (req, res) => {
  const sessionPayload = {
    title: req.body.title || "Practice Session",
    date: "Today",
    count: "3 questions",
    mode: req.body.mode || "focus",
    status: "active",
    attentionScore: 92
  };

  if (mongoose.connection.readyState !== 1) {
    exams[0] = { ...exams[0], ...sessionPayload };
    return res.status(201).json({ session: exams[0] });
  }

  const session = await ExamSession.create({
    userId: req.user._id,
    ...sessionPayload
  });

  return res.status(201).json({ session });
});

module.exports = router;
