// HTTP client for the Python RAG service in /planner-ai (FastAPI).

const PLANNER_AI_URL = (process.env.PLANNER_AI_URL || "http://127.0.0.1:8001").replace(/\/$/, "");

function serviceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GATEWAY_STATUSES = new Set([502, 503, 504]);
let lastAwakeAt = 0;
let wakeUp = null;

// A free Render instance sleeps after 15 idle minutes. While it wakes (about a minute) Render
// answers requests with an instant 502, so calls first wait for /health to answer.
function waitForPlanner(maxMs = 3 * 60 * 1000) {
  if (Date.now() - lastAwakeAt < 60 * 1000) {
    return Promise.resolve();
  }
  if (!wakeUp) {
    wakeUp = (async () => {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${PLANNER_AI_URL}/health`, { signal: AbortSignal.timeout(60 * 1000) });
          if (response.ok) {
            lastAwakeAt = Date.now();
            return;
          }
        } catch (_error) {
          // not up yet
        }
        await sleep(4000);
      }
    })().finally(() => {
      wakeUp = null;
    });
  }
  return wakeUp;
}

async function plannerFetch(path, body, timeoutMs, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    await waitForPlanner();
    let response;

    try {
      response = await fetch(`${PLANNER_AI_URL}${path}`, {
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
      if (attempt >= attempts) {
        throw serviceError("The planner AI service is not running. Start it with: npm run planner", 503);
      }
      lastAwakeAt = 0;
      await sleep(3000 * attempt);
      continue;
    }

    // Render's gateway errors (instance waking, restarting or briefly overloaded) are worth a retry.
    if (GATEWAY_STATUSES.has(response.status) && attempt < attempts) {
      lastAwakeAt = 0;
      await sleep(3000 * attempt);
      continue;
    }
    if (response.ok) {
      lastAwakeAt = Date.now();
    }
    return response;
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
function warmPlanner() {
  waitForPlanner().catch(() => {});
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
