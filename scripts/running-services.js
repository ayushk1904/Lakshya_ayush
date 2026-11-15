async function readHealth(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() : null;
  } catch (_error) {
    return null;
  }
}

function pointsToLocalApp(address, appUrl) {
  try {
    const target = new URL(address.includes("://") ? address : `http://${address}`);
    const app = new URL(appUrl);
    return ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
      && (target.port || "80") === (app.port || "80")
      && target.pathname === "/";
  } catch (_error) {
    return false;
  }
}

// ngrok chooses another local inspector port when another project's agent uses 4040.
async function findExistingTunnel(appUrl, domain = "", inspectorPorts = Array.from({ length: 10 }, (_, index) => 4040 + index)) {
  const agents = await Promise.all(inspectorPorts.map((port) => readHealth(`http://127.0.0.1:${port}/api/tunnels`)));
  for (const agent of agents) {
    for (const tunnel of Array.isArray(agent?.tunnels) ? agent.tunnels : []) {
      try {
        const publicUrl = new URL(tunnel.public_url);
        if (publicUrl.protocol === "https:" && (!domain || publicUrl.hostname === domain)
          && pointsToLocalApp(tunnel.config?.addr || "", appUrl)) {
          return tunnel.public_url;
        }
      } catch (_error) { /* Ignore unrelated or incomplete tunnel entries. */ }
    }
  }
  return null;
}

module.exports = { readHealth, findExistingTunnel };
