const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/authRoutes");
const chatRoomRoutes = require("./routes/chatRoomRoutes");
const conceptExplainerRoutes = require("./routes/conceptExplainerRoutes");
const examSessionRoutes = require("./routes/examSessionRoutes");
const studyPlanRoutes = require("./routes/studyPlanRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "lakshya-server",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    message: "Lakshya backend is ready for MERN feature integration."
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/study-plans", studyPlanRoutes);
app.use("/api/concept-explainer", conceptExplainerRoutes);
app.use("/api/chat-rooms", chatRoomRoutes);
app.use("/api/exam-sessions", examSessionRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
