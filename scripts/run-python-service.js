#!/usr/bin/env node
// Uses the root virtual environment, then a service-specific one, then system Python.
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
const servicePython = process.platform === "win32"
  ? path.join(serviceRoot, ".venv", "Scripts", "python.exe")
  : path.join(serviceRoot, ".venv", "bin", "python");
const sharedPython = process.platform === "win32"
  ? path.join(root, ".venv", "Scripts", "python.exe")
  : path.join(root, ".venv", "bin", "python");
const python = process.env.LAKSHYA_PYTHON || [sharedPython, servicePython].find((candidate) => fs.existsSync(candidate))
  || (process.platform === "win32" ? "python" : "python3");

const args = ["-m", "uvicorn", "main:app", "--app-dir", serviceDir, "--host", "127.0.0.1", "--port", port];
if (flags.includes("--reload")) {
  args.push("--reload", "--reload-dir", serviceDir);
}

console.log(`Starting ${serviceDir} on port ${port} with ${python}`);
const child = spawn(python, args, { cwd: root, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Could not start ${serviceDir}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
