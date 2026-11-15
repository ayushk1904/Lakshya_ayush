const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
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
const { warmOllama, getOllamaStatus } = require("./services/ollamaClient");

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

// Check the local AI services when the website opens.
app.get("/api/warmup", (_req, res) => {
  warmPlanner();
  warmProctor();
  warmOllama().catch((error) => console.warn("Ollama warmup:", error.message));
  res.json({ ok: true });
});

app.get("/api/ai/status", async (_req, res) => {
  try {
    res.json(await getOllamaStatus());
  } catch (_error) {
    res.status(503).json({ available: false, loaded: false, message: "Start Ollama to enable AI features." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/answer-evaluator", answerEvaluatorRoutes);
app.use("/api/study-plans", studyPlanRoutes);
app.use("/api/study-planner", studyPlannerRoutes);
app.use("/api/concept-explainer", conceptExplainerRoutes);
app.use("/api/chat-rooms", chatRoomRoutes);
app.use("/api/exam-sessions", examSessionRoutes);
app.use("/api/progress", progressRoutes);

// Serve the built React app from the same address as the API for the ngrok tunnel.
app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

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
