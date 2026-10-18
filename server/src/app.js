const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/authRoutes");
const answerEvaluatorRoutes = require("./routes/answerEvaluatorRoutes");
const chatRoomRoutes = require("./routes/chatRoomRoutes");
const conceptExplainerRoutes = require("./routes/conceptExplainerRoutes");
const examSessionRoutes = require("./routes/examSessionRoutes");
const progressRoutes = require("./routes/progressRoutes");
const studyPlanRoutes = require("./routes/studyPlanRoutes");
const studyPlannerRoutes = require("./routes/studyPlannerRoutes");
const { warmPlanner } = require("./services/plannerAiClient");
const { warmProctor } = require("./services/proctorAiClient");

const app = express();
const jsonBodyLimit = "8mb";

app.use(cors());
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "lakshya-server",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    message: "Lakshya backend is ready for MERN feature integration."
  });
});

// Called once when the website opens. Free Render instances sleep after 15 idle minutes and take
// about a minute to wake, so the backend (by this request) and both AI services start waking while
// the visitor is still on the landing or login page.
app.get("/api/warmup", (_req, res) => {
  warmPlanner();
  warmProctor();
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/answer-evaluator", answerEvaluatorRoutes);
app.use("/api/study-plans", studyPlanRoutes);
app.use("/api/study-planner", studyPlannerRoutes);
app.use("/api/concept-explainer", conceptExplainerRoutes);
app.use("/api/chat-rooms", chatRoomRoutes);
app.use("/api/exam-sessions", examSessionRoutes);
app.use("/api/progress", progressRoutes);

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      message: "Request payload is too large. Please upload a smaller image and try again."
    });
  }

  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
