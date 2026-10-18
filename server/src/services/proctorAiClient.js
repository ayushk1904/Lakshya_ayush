// HTTP client for the Python computer-vision service in /proctor-ai (FastAPI + OpenCV + YOLO).

const PROCTOR_AI_URL = (process.env.PROCTOR_AI_URL || "http://127.0.0.1:8002").replace(/\/$/, "");
const WAKING_MESSAGE = "The AI proctor is starting up. It begins checking within a minute; tab-switch protection is already on.";

function serviceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// A free Render instance sleeps after 15 idle minutes and answers 502/503 for about a minute
// while it wakes. One /health request at a time starts it, without holding up frame requests.
let wakeUp = null;
let lastWarmAt = 0;

function warmProctor() {
  if (!wakeUp && Date.now() - lastWarmAt > 60 * 1000) {
    lastWarmAt = Date.now();
    wakeUp = fetch(`${PROCTOR_AI_URL}/health`, { signal: AbortSignal.timeout(120 * 1000) })
      .catch(() => {})
      .finally(() => {
        wakeUp = null;
      });
  }
  return wakeUp;
}

async function analyzeFrame({ image, baseline }) {
  let response;

  try {
    response = await fetch(`${PROCTOR_AI_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.PROCTOR_AI_TOKEN ? { "X-Proctor-Token": process.env.PROCTOR_AI_TOKEN } : {})
      },
      body: JSON.stringify(baseline ? { image, baseline } : { image }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    warmProctor();
    if (error.name === "TimeoutError") {
      throw serviceError(WAKING_MESSAGE, 503);
    }
    if (PROCTOR_AI_URL.includes("127.0.0.1") || PROCTOR_AI_URL.includes("localhost")) {
      throw serviceError("The proctor vision service is not running. Start it with: npm run proctor", 503);
    }
    throw serviceError(WAKING_MESSAGE, 503);
  }

  if ([502, 503, 504].includes(response.status)) {
    warmProctor();
    throw serviceError(WAKING_MESSAGE, 503);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw serviceError(detail || `Proctor vision failed (${response.status})`, response.status === 400 || response.status === 413 ? 400 : 502);
  }

  return data;
}

module.exports = {
  analyzeFrame,
  warmProctor
};
