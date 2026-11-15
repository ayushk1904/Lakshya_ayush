// Shared local Qwen client for every Express AI feature. No API key is needed.
function getModel() {
  return {
    provider: "ollama",
    baseUrl: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL || "qwen2.5:7b"
  };
}

function keepAlive() {
  const value = process.env.OLLAMA_KEEP_ALIVE || "-1";
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

function contextLength(systemPrompt = "", userPrompt = "", maxTokens = 1200) {
  const base = Number(process.env.OLLAMA_NUM_CTX || 8192);
  const maximum = Math.max(base, Number(process.env.OLLAMA_MAX_CTX || 16384));
  const needed = Math.ceil((String(systemPrompt).length + String(userPrompt).length) / 3) + maxTokens + 512;
  return Math.min(maximum, Math.max(base, 2 ** Math.ceil(Math.log2(needed))));
}

async function generateText({ modelConfig = getModel(), systemPrompt, userPrompt, temperature = 0.3, json = false, maxTokens = 1200, signal }) {
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_SECONDS || 300) * 1000;
  let response;
  try {
    response = await fetch(`${modelConfig.baseUrl}/api/chat`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelConfig.model,
        stream: false,
        keep_alive: keepAlive(),
        ...(json ? { format: typeof json === "object" ? json : "json" } : {}),
        options: { temperature, num_ctx: contextLength(systemPrompt, userPrompt, maxTokens), num_predict: maxTokens },
        messages: [
          { role: "system", content: json ? `${systemPrompt}\nReturn a single valid JSON object only.` : systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === "TimeoutError") {
      throw new Error("Ollama took too long to respond. Try again or increase OLLAMA_TIMEOUT_SECONDS.");
    }
    throw new Error("Could not reach Ollama. Start Ollama and run: ollama pull " + modelConfig.model);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(typeof data.error === "string" ? data.error : `Ollama request failed (${response.status})`);
  }
  const content = data.message?.content?.trim();
  if (!content) {
    throw new Error("Ollama returned an empty answer.");
  }
  if (data.done_reason === "length") {
    throw new Error("The AI answer reached its length limit. Ask for a smaller section or fewer questions.");
  }
  if (process.env.OLLAMA_LOG_TIMINGS === "true") {
    const seconds = (value) => Math.round((value || 0) / 1e7) / 100;
    console.log("Ollama timing:", JSON.stringify({ model: modelConfig.model, totalSeconds: seconds(data.total_duration), loadSeconds: seconds(data.load_duration), promptTokens: data.prompt_eval_count, outputTokens: data.eval_count, generationSeconds: seconds(data.eval_duration) }));
  }
  return content;
}

async function generateModelJson(options) {
  return JSON.parse(await generateText({ ...options, json: true }));
}

let warming = null;
async function getOllamaStatus() {
  const config = getModel();
  const response = await fetch(`${config.baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Ollama is unavailable");
  const data = await response.json();
  const loaded = data.models?.find((entry) => entry.name === config.model || entry.name === `${config.model}:latest`);
  const processor = !loaded ? null : !loaded.size_vram ? "CPU" : loaded.size_vram >= loaded.size ? "GPU" : "CPU/GPU";
  return { available: true, model: config.model, loaded: Boolean(loaded), processor, contextLength: loaded?.context_length || null };
}

function warmOllama() {
  if (warming) return warming;
  warming = (async () => {
    const status = await getOllamaStatus();
    if (status.loaded) return status;
    const config = getModel();
    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, messages: [], stream: false, keep_alive: keepAlive(), options: { num_ctx: Number(process.env.OLLAMA_NUM_CTX || 8192) } }),
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_SECONDS || 300) * 1000)
    });
    if (!response.ok) throw new Error("Could not prepare the Ollama model");
    await response.json();
    return getOllamaStatus();
  })().finally(() => { warming = null; });
  return warming;
}

module.exports = { getModel, generateText, generateModelJson, getOllamaStatus, warmOllama };
