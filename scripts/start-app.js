#!/usr/bin/env node
// Build and host the full app locally, optionally publishing one ngrok HTTPS endpoint.
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const net = require("net");
const { readHealth, findExistingTunnel } = require("./running-services");

const root = path.resolve(__dirname, "..");
const dotenv = require(require.resolve("dotenv", { paths: [path.join(root, "server")] }));
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "server", ".env") });

const isPublic = process.argv.includes("--public");
const isFixed = process.argv.includes("--fixed");
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || "127.0.0.1";
const localUrl = `http://127.0.0.1:${port}`;
const ollamaUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch (_error) { /* Already exited. */ }
    }
  }
  process.exit(code);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
    ...options
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${command} stopped (${code ?? "signal"}). Shutting down Lakshya.`);
      stop(code ?? 1);
    }
  });
  return child;
}

async function waitFor(url, label, predicate = () => true, maxMs = 180000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        if (predicate(data)) return data;
      }
    } catch (_error) { /* Service is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} is not ready. Check its startup messages above.`);
}

async function assertFreePort(servicePort) {
  await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", () => reject(new Error(`Port ${servicePort} is already in use. Stop that service before starting Lakshya.`)));
    socket.listen(servicePort, "127.0.0.1", () => socket.close(resolve));
  });
}

async function openPublicTunnel(domain) {
  const existing = await findExistingTunnel(localUrl, domain);
  if (existing) {
    console.log(`Lakshya is already online at ${existing}`);
    return;
  }
  console.log(domain ? `Public address: https://${domain}` : "ngrok will display your public HTTPS address below.");
  start(process.execPath, ["scripts/start-ngrok.js"]);
}

async function main() {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    throw new Error("Set MONGODB_URI and JWT_SECRET in .env or server/.env first. See .env.example.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8001 || port === 8002) {
    throw new Error("PORT must be a valid port other than 8001 or 8002.");
  }
  const domain = (process.env.NGROK_DOMAIN || "").trim();
  if (isFixed && !domain) {
    throw new Error("Set NGROK_DOMAIN in .env to your domain from https://dashboard.ngrok.com/domains");
  }
  if (domain && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)) {
    throw new Error("NGROK_DOMAIN must be a hostname without https:// or a path.");
  }
  const existingApp = await readHealth(`${localUrl}/api/health`);
  if (existingApp?.service === "lakshya-server") {
    if (existingApp.database !== "connected") {
      throw new Error("Lakshya is already running, but MongoDB is disconnected. Check its original server window.");
    }
    const planner = await readHealth("http://127.0.0.1:8001/health");
    const proctor = await readHealth("http://127.0.0.1:8002/health");
    if (planner?.service !== "planner-ai" || proctor?.service !== "proctor-ai") {
      throw new Error("Lakshya is already running, but an AI service is unavailable. Start it with npm run planner or npm run proctor.");
    }
    console.log(`Lakshya is already running at ${localUrl}.`);
    if (isPublic) await openPublicTunnel(domain);
    if (!children.size) console.log("You can close this extra window. Keep the original app and tunnel windows running.");
    else console.log("Keep this window open for the new tunnel. The existing app stays in its original window.");
    return;
  }
  // Validate ownership of ports before launching any child processes.
  for (const servicePort of [port, 8001, 8002]) await assertFreePort(servicePort);
  if (isPublic) {
    const check = spawnSync("ngrok", ["version"], { stdio: "inherit", windowsHide: true });
    if (check.error || check.status !== 0) {
      throw new Error("Install ngrok, then run: ngrok config add-authtoken YOUR_TOKEN");
    }
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Ollama unavailable");
  } catch (_error) {
    if (!["127.0.0.1", "localhost"].includes(new URL(ollamaUrl).hostname)) {
      throw new Error(`Could not reach Ollama at ${ollamaUrl}`);
    }
    console.log("Starting Ollama...");
    start("ollama", ["serve"]);
  }
  const tags = await waitFor(`${ollamaUrl}/api/tags`, "Ollama");
  if (!tags.models?.some((item) => item.name === model || item.name === `${model}:latest`)) {
    throw new Error(`The Qwen model is missing. Run: ollama pull ${model}`);
  }

  console.log("Building the website...");
  // Launch Vite through Node so Windows does not need a command shell for npm.cmd.
  const vite = path.join(path.dirname(require.resolve("vite/package.json", { paths: [path.join(root, "client")] })), "bin", "vite.js");
  const build = spawnSync(process.execPath, [vite, "build"], {
    cwd: path.join(root, "client"),
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, VITE_API_URL: "/api", VITE_PUBLIC_APP_URL: "" }
  });
  if (build.error || build.status !== 0) throw new Error("Website build failed. Run npm --prefix client install and try again.");

  // Keep the private services on this machine; the browser reaches them through /api.
  process.env.PLANNER_AI_URL = "http://127.0.0.1:8001";
  process.env.PROCTOR_AI_URL = "http://127.0.0.1:8002";
  start(process.execPath, ["scripts/run-python-service.js", "planner-ai", "8001"]);
  start(process.execPath, ["scripts/run-python-service.js", "proctor-ai", "8002"]);
  start(process.execPath, ["server/index.js"], { env: { ...process.env, HOST: host, PORT: String(port) } });

  await waitFor("http://127.0.0.1:8001/health", "Planner AI", (data) => data.llm === "ollama");
  await waitFor("http://127.0.0.1:8002/health", "Proctor AI");
  const health = await waitFor(`${localUrl}/api/health`, "Lakshya backend");
  if (health.database !== "connected") {
    throw new Error("MongoDB is unavailable. Start MongoDB or correct MONGODB_URI before hosting the app.");
  }
  console.log(`\nLakshya is ready at ${localUrl}, using Ollama ${model}.`);

  if (isPublic) {
    await openPublicTunnel(domain);
  }
  console.log("Keep this window open. Press Ctrl+C to stop the app and its tunnel.");
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
main().catch((error) => {
  console.error(error.message);
  stop(1);
});
