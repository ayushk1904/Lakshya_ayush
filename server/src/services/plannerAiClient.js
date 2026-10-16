// HTTP client for the Python RAG service in /planner-ai (FastAPI).

const PLANNER_AI_URL = (process.env.PLANNER_AI_URL || "http://127.0.0.1:8001").replace(/\/$/, "");

function serviceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function plannerFetch(path, body, timeoutMs) {
  try {
    return await fetch(`${PLANNER_AI_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.PLANNER_AI_TOKEN ? { "X-Planner-Token": process.env.PLANNER_AI_TOKEN } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw serviceError("The planner AI service took too long to respond. Please try again.", 504);
    }
    throw serviceError("The planner AI service is not running. Start it with: npm run planner", 503);
  }
}

// Streams newline-delimited JSON (progress / heartbeat / result / error) while one syllabus is indexed.
async function ingestOnce(text, onProgress) {
  const response = await plannerFetch("/ingest", { text }, 30 * 60 * 1000);
  if (!response.ok || !response.body) {
    throw serviceError(`Planner AI ingest failed (${response.status})`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines.filter((value) => value.trim())) {
        const event = JSON.parse(line);
        if (event.type === "progress") {
          await onProgress?.({ done: event.done, total: event.total });
        } else if (event.type === "result") {
          result = event;
        } else if (event.type === "error") {
          throw serviceError(event.message || "Failed to index syllabus", 500);
        }
      }
    }
  } catch (error) {
    if (error.status) {
      throw error;
    }
    // "terminated" / ECONNRESET: the planner service restarted or the connection dropped.
    throw serviceError("Lost the connection to the planner AI service while indexing.", 503);
  }

  if (!result) {
    throw serviceError("Lost the connection to the planner AI service while indexing.", 503);
  }
  return result;
}

// Connection problems are retried; finished subjects are cached by the Python service, so a retry resumes quickly.
async function ingestSyllabus(text, onProgress, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await ingestOnce(text, onProgress);
    } catch (error) {
      if (error.status !== 503 || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

async function buildPlan(payload) {
  const response = await plannerFetch("/plan", payload, 3 * 60 * 1000);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw serviceError(detail || `Planner AI failed (${response.status})`, response.status === 400 ? 400 : 502);
  }
  return data;
}

// Previous-year paper PDF -> structured questions, figures and tables (OCR when the PDF's text
// layer is unreadable, which is common for protected university papers).
async function ingestPaper(buffer, fileName) {
  const response = await plannerFetch("/papers/ingest", { pdf_base64: buffer.toString("base64"), file_name: fileName }, 5 * 60 * 1000);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    const fallback = response.status === 422 ? "This file is not a readable PDF question paper." : `Paper analysis failed (${response.status})`;
    throw serviceError(detail || fallback, [400, 413, 422].includes(response.status) ? 400 : 502);
  }
  return data;
}

// A free Render instance sleeps after 15 idle minutes and takes about a minute to wake. Pinging
// it when the Practice Tests page opens means it is usually awake by the time a paper is chosen.
let lastWarmUp = 0;

function warmPlanner() {
  if (Date.now() - lastWarmUp < 5 * 60 * 1000) {
    return;
  }
  lastWarmUp = Date.now();
  fetch(`${PLANNER_AI_URL}/health`, { signal: AbortSignal.timeout(120 * 1000) }).catch(() => {});
}

// Structured papers -> a new practice test in the same format (RAG over the selected papers).
async function generatePracticeTest(payload) {
  const response = await plannerFetch("/papers/generate", payload, 4 * 60 * 1000);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw serviceError(detail || `Practice test generation failed (${response.status})`, response.status === 400 ? 400 : 502);
  }
  return data;
}

module.exports = {
  buildPlan,
  generatePracticeTest,
  ingestPaper,
  ingestSyllabus,
  warmPlanner
};
