const express = require("express");
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/authMiddleware");
const StudyActivity = require("../models/StudyActivity");

const router = express.Router();

router.use(authMiddleware);

const FEATURES = ["planner", "explainer", "hub", "tests", "proctor", "evaluator", "coach"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MINUTES_PER_PING = 15;

function cleanDay(value) {
  const day = String(value || "").trim();
  return DAY_PATTERN.test(day) ? day : new Date().toISOString().slice(0, 10);
}

function cleanFeature(value) {
  const feature = String(value || "").trim().toLowerCase();
  return FEATURES.includes(feature) ? feature : null;
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function requireDatabase(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ message: "Database unavailable. Progress tracking needs MongoDB." });
    return false;
  }

  return true;
}

// Heartbeat from the client: adds minutes spent on a study page for the given local day.
router.post("/time", async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const feature = cleanFeature(req.body.feature);
  const minutes = Number(req.body.minutes);

  if (!feature || !Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ message: "A valid feature and positive minutes are required." });
  }

  await StudyActivity.findOneAndUpdate(
    { userId: req.user._id, type: "time", feature, day: cleanDay(req.body.day) },
    { $inc: { minutes: Math.min(minutes, MAX_MINUTES_PER_PING) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.json({ success: true });
});

// A scored result (quiz, evaluation, revision round) or a plain study action.
router.post("/events", async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const feature = cleanFeature(req.body.feature);
  const type = req.body.type === "score" ? "score" : "activity";
  const score = Number(req.body.score);

  if (!feature) {
    return res.status(400).json({ message: "A valid feature is required." });
  }

  if (type === "score" && !Number.isFinite(score)) {
    return res.status(400).json({ message: "A numeric score is required." });
  }

  const event = await StudyActivity.create({
    userId: req.user._id,
    type,
    feature,
    day: cleanDay(req.body.day),
    score: type === "score" ? Math.max(0, Math.min(100, Math.round(score))) : null,
    label: String(req.body.label || "").trim().slice(0, 140)
  });

  return res.status(201).json({ event });
});

router.get("/summary", async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const today = cleanDay(req.query.today);
  const entries = await StudyActivity.find({ userId: req.user._id }).sort({ createdAt: 1 }).lean();

  const timeEntries = entries.filter((entry) => entry.type === "time");
  const scoreEntries = entries.filter((entry) => entry.type === "score");
  const actionEntries = entries.filter((entry) => entry.type !== "time");

  const minutesByDay = new Map();
  const minutesByFeature = Object.fromEntries(FEATURES.map((feature) => [feature, 0]));

  timeEntries.forEach((entry) => {
    minutesByDay.set(entry.day, (minutesByDay.get(entry.day) || 0) + entry.minutes);
    minutesByFeature[entry.feature] = (minutesByFeature[entry.feature] || 0) + entry.minutes;
  });

  const weekly = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDay(today, index - 6);
    return { day, minutes: round(minutesByDay.get(day) || 0) };
  });

  // A day counts toward the streak if the student studied or logged any result on it.
  const activeDays = new Set([...minutesByDay.entries()].filter(([, minutes]) => minutes >= 1).map(([day]) => day));
  actionEntries.forEach((entry) => activeDays.add(entry.day));

  let streak = 0;
  let cursor = activeDays.has(today) ? today : shiftDay(today, -1);
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  const scores = scoreEntries.map((entry) => ({
    score: entry.score,
    feature: entry.feature,
    label: entry.label,
    day: entry.day,
    createdAt: entry.createdAt
  }));
  const scoreValues = scores.map((entry) => entry.score);
  const recentAverage = average(scoreValues.slice(-5));
  const previousAverage = average(scoreValues.slice(-10, -5));

  return res.json({
    today,
    totalMinutes: round(timeEntries.reduce((sum, entry) => sum + entry.minutes, 0)),
    weekly,
    byFeature: FEATURES.map((feature) => ({ feature, minutes: round(minutesByFeature[feature] || 0) })),
    streak,
    activeDays: activeDays.size,
    actionsCount: actionEntries.length,
    featuresUsed: FEATURES.filter((feature) => minutesByFeature[feature] >= 1 || actionEntries.some((entry) => entry.feature === feature)).length,
    scores: scores.slice(-30),
    averageScore: scoreValues.length ? round(average(scoreValues)) : null,
    improvement: recentAverage !== null && previousAverage !== null ? round(recentAverage - previousAverage) : null,
    recent: actionEntries
      .slice(-8)
      .reverse()
      .map((entry) => ({
        id: entry._id,
        type: entry.type,
        feature: entry.feature,
        label: entry.label,
        score: entry.score,
        createdAt: entry.createdAt
      }))
  });
});

module.exports = router;
