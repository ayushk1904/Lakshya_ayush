const express = require("express");
const mongoose = require("mongoose");
const StudyPlan = require("../models/StudyPlan");
const authMiddleware = require("../middleware/authMiddleware");
const { coach, studyPlan } = require("../utils/mockData");
const { buildSchedule } = require("../utils/studyPlanner");

const router = express.Router();

router.use(authMiddleware);

router.get("/today", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json(studyPlan);
  }

  const plan = await StudyPlan.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json(plan || studyPlan);
});

router.post("/generate", async (req, res) => {
  const generatedPlan = buildSchedule(req.body);

  if (mongoose.connection.readyState !== 1) {
    return res.status(201).json({ plan: generatedPlan });
  }

  const plan = await StudyPlan.create({
    userId: req.user._id,
    studyDate: generatedPlan.studyDate,
    syllabusName: generatedPlan.syllabusName,
    studyWindow: generatedPlan.studyWindow,
    summary: generatedPlan.summary,
    studyProgress: generatedPlan.studyProgress,
    sessions: generatedPlan.sessions,
    todayPlan: generatedPlan.todayPlan,
    coach: generatedPlan.coach
  });

  return res.status(201).json({ plan });
});

router.get("/last-minute", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ coach });
  }

  const plan = await StudyPlan.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json({ coach: plan?.coach || coach });
});

module.exports = router;
