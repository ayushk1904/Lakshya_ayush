// HTTP client for the Python computer-vision service in /proctor-ai (FastAPI + OpenCV + YOLO).

const PROCTOR_AI_URL = (process.env.PROCTOR_AI_URL || "http://127.0.0.1:8002").replace(/\/$/, "");

function serviceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
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
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw serviceError("The proctor vision service took too long to respond.", 504);
    }
    throw serviceError("The proctor vision service is not running. Start it with: npm run proctor", 503);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw serviceError(detail || `Proctor vision failed (${response.status})`, response.status === 400 || response.status === 413 ? 400 : 502);
  }

  return data;
}

module.exports = {
  analyzeFrame
};
