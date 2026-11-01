import { createApp } from "./app.js";

const rawPort = process.env["MCP_PORT"] ?? "3001";
if (!/^\d+$/.test(rawPort)) {
  throw new Error("MCP_PORT must be an integer between 1 and 65535.");
}
const port = Number(rawPort);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("MCP_PORT must be an integer between 1 and 65535.");
}

// Local-only until the authenticated transport is in place.
const server = createApp().listen(port, "127.0.0.1", () => {
  console.info(`TAME service listening on http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

function shutdown() {
  const deadline = setTimeout(() => {
    server.closeAllConnections();
  }, 5_000);
  deadline.unref();
  server.close(() => clearTimeout(deadline));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
