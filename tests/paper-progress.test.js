const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");

async function planner(t, respond) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end('{"status":"ok"}');
      return;
    }
    for await (const _chunk of req) { /* Consume the raw PDF. */ }
    respond(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.PLANNER_AI_URL;
  process.env.PLANNER_AI_URL = `http://127.0.0.1:${server.address().port}`;
  const modulePath = require.resolve("../server/src/services/plannerAiClient");
  delete require.cache[modulePath];
  const client = require(modulePath);
  t.after(async () => {
    delete require.cache[modulePath];
    if (previous === undefined) delete process.env.PLANNER_AI_URL; else process.env.PLANNER_AI_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  return client;
}

test("paper progress survives fragmented NDJSON and returns the complete analysis", async (t) => {
  const result = { structure: { questions: [{ parts: [{ text: "Explain RSA." }] }] }, page_count: 2 };
  const client = await planner(t, (req, res) => {
    assert.equal(req.headers.accept, "application/x-ndjson");
    res.setHeader("Content-Type", "application/x-ndjson");
    res.write('{"type":"pro');
    res.write('gress","message":"Reading page 1 of 2","done":0,"total":2}\n');
    res.end(JSON.stringify({ type: "result", data: result }));
  });
  const events = [];
  assert.deepEqual(await client.ingestPaper(Buffer.from("%PDF test"), "test.pdf", (event) => events.push(event)), result);
  assert.equal(events[0].message, "Reading page 1 of 2");
});

test("paper stream errors become actionable failures instead of hanging", async (t) => {
  const client = await planner(t, (_req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.end('{"type":"error","status":422,"message":"No questions could be found"}\n');
  });
  await assert.rejects(client.ingestPaper(Buffer.from("%PDF test"), "test.pdf"), (error) => error.status === 400 && /No questions/.test(error.message));
});

test("older planner services returning JSON remain compatible", async (t) => {
  const result = { structure: { questions: [] }, page_count: 1 };
  const client = await planner(t, (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  assert.deepEqual(await client.ingestPaper(Buffer.from("%PDF test"), "test.pdf"), result);
});
