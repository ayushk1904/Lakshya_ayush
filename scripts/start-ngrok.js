#!/usr/bin/env node
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { prepareNgrokConfig } = require("./ngrok-config");
const { findExistingTunnel } = require("./running-services");

const root = path.resolve(__dirname, "..");
const dotenv = require(require.resolve("dotenv", { paths: [path.join(root, "server")] }));
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "server", ".env") });

async function main() {
  const port = Number(process.env.PORT || 5000);
  const domain = (process.env.NGROK_DOMAIN || "").trim();
  if (domain && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)) {
    throw new Error("NGROK_DOMAIN must be a hostname without https:// or a path.");
  }
  const url = `http://127.0.0.1:${port}`;
  const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
  if (health.service !== "lakshya-server" || health.database !== "connected") {
    throw new Error("Start Lakshya with npm start and check MongoDB before opening its tunnel.");
  }

  const existing = await findExistingTunnel(url, domain);
  if (existing) {
    console.log(`Lakshya is already online at ${existing}`);
    return;
  }

  const config = prepareNgrokConfig(root, process.env.NGROK_AUTHTOKEN || "");
  process.on("exit", () => config.cleanup());
  const check = spawnSync("ngrok", ["config", "check", ...config.args], { stdio: "inherit", windowsHide: true });
  if (check.error || check.status !== 0) throw new Error("Install ngrok and check your account configuration.");

  const child = spawn("ngrok", ["http", ...config.args, ...(domain ? [`--url=https://${domain}`] : []), url, "--log=stdout"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  child.on("error", (error) => {
    console.error(`Could not start ngrok: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => { process.exitCode = code || 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
