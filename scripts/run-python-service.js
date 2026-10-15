#!/usr/bin/env node
// Starts a Python service with its own virtual environment when it has one, so packages such as
// RapidOCR (planner-ai) or OpenCV (proctor-ai) are always found. Falls back to the system Python.
//
// Usage: node scripts/run-python-service.js <service-dir> <port> [--reload]

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const [serviceDir, port, ...flags] = process.argv.slice(2);

if (!serviceDir || !port) {
  console.error("Usage: node scripts/run-python-service.js <service-dir> <port> [--reload]");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const serviceRoot = path.join(root, serviceDir);
const venvPython = process.platform === "win32"
  ? path.join(serviceRoot, ".venv", "Scripts", "python.exe")
  : path.join(serviceRoot, ".venv", "bin", "python");
const python = fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";

const args = ["-m", "uvicorn", "main:app", "--app-dir", serviceDir, "--port", port];
if (flags.includes("--reload")) {
  args.push("--reload", "--reload-dir", serviceDir);
}

console.log(`Starting ${serviceDir} on port ${port} with ${python === venvPython ? `${serviceDir}/.venv` : "system Python"}`);
const child = spawn(python, args, { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
