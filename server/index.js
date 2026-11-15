try {
  const path = require("path");
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (_error) {
  console.warn("dotenv not installed. Continuing with system environment variables only.");
}

// Honour the optional OS trust store setting even when dotenv loads it after Node starts.
const tls = require("node:tls");
if (process.env.NODE_USE_SYSTEM_CA === "1" && typeof tls.setDefaultCACertificates === "function") {
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
}
const app = require("./src/app");
const connectDB = require("./src/config/db");
const { warmOllama } = require("./src/services/ollamaClient");

const prepareAi = () => warmOllama().catch((error) => console.warn("Ollama warmup:", error.message));
prepareAi();
setInterval(prepareAi, 60 * 1000).unref();

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || 5000;

const { resumeInterruptedIndexing } = require("./src/routes/studyPlannerRoutes");
const { resumeInterruptedPaperReading } = require("./src/services/paperAnalysis");

connectDB().then((connected) => {
  if (connected) {
    resumeInterruptedIndexing().catch((error) => console.error("resume indexing error:", error));
    resumeInterruptedPaperReading().catch((error) => console.error("resume paper reading error:", error));
  }
}).finally(() => {
  app.listen(port, host, () => {
    console.log(`Lakshya server listening on http://${host}:${port}`);
  });
});
