const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { readHealth, findExistingTunnel } = require("../scripts/running-services");

async function inspector(t, tunnels) {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ tunnels }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test("finds Lakshya's existing tunnel while another agent serves Manzil", async (t) => {
  const manzil = await inspector(t, [{ public_url: "https://manzil.ngrok-free.dev", config: { addr: "http://localhost:8000" } }]);
  const lakshya = await inspector(t, [{ public_url: "https://lakshya.ngrok-free.dev", config: { addr: "http://localhost:5002" } }]);
  assert.equal(await findExistingTunnel("http://127.0.0.1:5002", "lakshya.ngrok-free.dev", [manzil, lakshya]), "https://lakshya.ngrok-free.dev");
});

test("does not reuse a tunnel for a different port, domain, or remote machine", async (t) => {
  const port = await inspector(t, [
    { public_url: "https://lakshya.ngrok-free.dev", config: { addr: "http://localhost:8000" } },
    { public_url: "https://another.ngrok-free.dev", config: { addr: "http://127.0.0.1:5002" } },
    { public_url: "https://lakshya.ngrok-free.dev", config: { addr: "http://example.com:5002" } }
  ]);
  assert.equal(await findExistingTunnel("http://127.0.0.1:5002", "lakshya.ngrok-free.dev", [port]), null);
});

test("an unavailable service is handled without claiming it is running", async () => {
  assert.equal(await readHealth("http://127.0.0.1:0/api/health"), null);
});
