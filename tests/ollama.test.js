const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { getModel, generateText, generateModelJson, warmOllama } = require("../server/src/services/ollamaClient");

async function mockOllama(t, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    handler(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { ...getModel(), baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("Qwen JSON requests use Ollama's native API without cloud credentials", async (t) => {
  const modelConfig = await mockOllama(t, (req, res, body) => {
    assert.equal(req.url, "/api/chat");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(body.stream, false);
    assert.equal(body.format, "json");
    assert.equal(body.model, "qwen2.5:7b");
    assert.ok(body.options.num_ctx >= 8192);
    assert.equal(body.options.num_predict, 1200);
    assert.equal(body.keep_alive, -1);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: { content: '{"marks":85,"feedback":["Explain the example"]}' } }));
  });
  const data = await generateModelJson({ modelConfig, systemPrompt: "Evaluate the answer", userPrompt: "Sample answer" });
  assert.equal(data.marks, 85);
  assert.deepEqual(data.feedback, ["Explain the example"]);
});

test("text answers remain markdown without forcing JSON", async (t) => {
  const modelConfig = await mockOllama(t, (_req, res, body) => {
    assert.equal(body.format, undefined);
    assert.equal(body.messages[1].content, "Explain gravity");
    res.end(JSON.stringify({ message: { content: "  ## Gravity\nMass attracts mass.  " } }));
  });
  assert.equal(await generateText({ modelConfig, systemPrompt: "Teach", userPrompt: "Explain gravity" }), "## Gravity\nMass attracts mass.");
});

test("missing-model errors are preserved for feature fallback handling", async (t) => {
  const modelConfig = await mockOllama(t, (_req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "model 'qwen2.5:7b' not found" }));
  });
  await assert.rejects(generateText({ modelConfig, userPrompt: "Hello" }), /model.*not found/);
});

test("empty and invalid JSON answers fail instead of reporting successful AI output", async (t) => {
  let empty = true;
  const modelConfig = await mockOllama(t, (_req, res) => {
    res.end(JSON.stringify({ message: { content: empty ? "" : "invalid json" } }));
  });
  await assert.rejects(generateText({ modelConfig, userPrompt: "Hello" }), /empty answer/);
  empty = false;
  await assert.rejects(generateModelJson({ modelConfig, userPrompt: "Hello" }), SyntaxError);
});

test("short tasks keep a small GPU context while long evidence gets enough room", async (t) => {
  const contexts = [];
  const modelConfig = await mockOllama(t, (_req, res, body) => {
    contexts.push(body.options.num_ctx);
    assert.equal(body.options.num_predict, 500);
    res.end(JSON.stringify({ message: { content: "A complete answer" } }));
  });
  await generateText({ modelConfig, systemPrompt: "Coach", userPrompt: "One question", maxTokens: 500 });
  await generateText({ modelConfig, systemPrompt: "Evaluate", userPrompt: "x".repeat(30000), maxTokens: 500 });
  assert.deepEqual(contexts, [8192, 16384]);
});

test("a truncated JSON response is rejected rather than used as a successful quiz", async (t) => {
  const modelConfig = await mockOllama(t, (_req, res) => {
    res.end(JSON.stringify({ done_reason: "length", message: { content: '{"questions":[]}' } }));
  });
  await assert.rejects(generateModelJson({ modelConfig, userPrompt: "Quiz" }), /length limit/);
});

test("structured quizzes pass their schema and answer budget to Ollama", async (t) => {
  const schema = { type: "object", required: ["questions"], properties: { questions: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } } } };
  const modelConfig = await mockOllama(t, (_req, res, body) => {
    assert.deepEqual(body.format, schema);
    assert.equal(body.options.num_predict, 1100);
    res.end(JSON.stringify({ message: { content: '{"questions":["a","b","c","d","e"]}' } }));
  });
  const result = await generateText({ modelConfig, json: schema, maxTokens: 1100, userPrompt: "Five questions" });
  assert.equal(JSON.parse(result).questions.length, 5);
});

test("warmup preloads once and reuses an already loaded GPU model", async (t) => {
  let loaded = false;
  let loads = 0;
  const modelConfig = await mockOllama(t, (req, res, body) => {
    if (req.url === "/api/ps") {
      res.end(JSON.stringify({ models: loaded ? [{ name: modelConfig.model, size: 5000, size_vram: 5000, context_length: 8192 }] : [] }));
    } else {
      loads += 1;
      assert.deepEqual(body.messages, []);
      assert.equal(body.keep_alive, -1);
      loaded = true;
      res.end(JSON.stringify({ done: true }));
    }
  });
  const previous = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = modelConfig.baseUrl;
  t.after(() => { if (previous === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = previous; });
  const results = await Promise.all([warmOllama(), warmOllama()]);
  assert.equal(results[0].processor, "GPU");
  await warmOllama();
  assert.equal(loads, 1);
});

test("one Express address serves the frontend, SPA deep links and API responses", async (t) => {
  const app = require("../server/src/app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/", "/app/hub?join=test-invite"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(await response.text(), /id="root"/);
  }
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal((await health.json()).service, "lakshya-server");
  const missing = await fetch(`${baseUrl}/api/missing-route`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).message, "API route not found");
});
