import { createBackend } from "./backend.js";
import { readWorkerConfig } from "./config.js";
import { runWorker } from "./runner.js";

const config = readWorkerConfig();
const args = process.argv.slice(2);
if (!config || args.some(arg => arg !== "--once")) {
  console.error(JSON.stringify({ event: "worker_configuration_invalid" }));
  process.exitCode = 1;
} else {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.info(JSON.stringify({ event: "worker_started" }));
  try {
    await runWorker(createBackend(config), {
      signal: shutdown.signal, pollMs: config.pollMs, once: args.includes("--once"),
      log: event => console.info(JSON.stringify(event)),
    });
  } catch {
    console.error(JSON.stringify({ event: "worker_failed" }));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
