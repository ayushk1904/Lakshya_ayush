const fs = require("node:fs");
const path = require("node:path");

// The CLI does not automatically select the account from NGROK_AUTHTOKEN.
// Give it a private config file instead of exposing the token in command arguments.
function prepareNgrokConfig(root, token = "") {
  if (!token.trim()) return { args: [], cleanup() {} };

  const cache = path.join(root, ".cache");
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(cache, "ngrok-"));
  const config = path.join(directory, "ngrok.yml");
  try {
    fs.writeFileSync(config, `version: 3\nagent:\n  authtoken: ${JSON.stringify(token.trim())}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    fs.rmdirSync(directory);
    throw error;
  }

  return {
    args: ["--config", config],
    cleanup() {
      // Delete only the exact file and empty directory created by this invocation.
      try { fs.unlinkSync(config); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { fs.rmdirSync(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
}

module.exports = { prepareNgrokConfig };
