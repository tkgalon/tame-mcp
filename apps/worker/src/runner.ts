import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { claimedJobSchema, WorkerFault } from "./backend.js";
import type { ClaimedJob, WorkerBackend } from "./backend.js";
import { parseInChild } from "./parser-process.js";
import { parserVersion } from "./parse-document.js";

export type JobOutcome = "completed" | "retried" | "lease_lost" | "release_failed";
export type WorkerEvent = { event: string; jobId?: string; outcome?: JobOutcome; durationMs?: number };
type Parser = typeof parseInChild;

export async function processJob(
  backend: WorkerBackend, rawJob: ClaimedJob, signal: AbortSignal,
  parse: Parser = parseInChild,
): Promise<JobOutcome> {
  const checked = claimedJobSchema.safeParse(rawJob);
  if (!checked.success) throw new WorkerFault("worker_error");
  const job = checked.data;
  const remainingMs = Date.parse(job.lease_until) - Date.now() - 5_000;
  if (remainingMs <= 0) return "lease_lost";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(Math.min(75_000, remainingMs))]);
  try {
    deadline.throwIfAborted();
    const bytes = await backend.download(job, deadline);
    if (bytes.byteLength !== job.size_bytes || (job.content_hash !== null
      && createHash("sha256").update(bytes).digest("hex") !== job.content_hash)
      || (job.parser_version !== null && job.parser_version !== parserVersion(job.media_type))) {
      throw new WorkerFault("worker_error");
    }
    const result = await parse(bytes, job.media_type, { signal: deadline });
    deadline.throwIfAborted();
    return await backend.finish(job, result, deadline) ? "completed" : "lease_lost";
  } catch (error) {
    const code = error instanceof WorkerFault ? error.code : "worker_error";
    try {
      return await backend.retry(job, code, AbortSignal.timeout(10_000)) ? "retried" : "lease_lost";
    } catch { return "release_failed"; }
  }
}

export async function runWorker(
  backend: WorkerBackend,
  options: { signal: AbortSignal; pollMs: number; once?: boolean; log?: (event: WorkerEvent) => void },
): Promise<void> {
  const log = options.log ?? (() => {});
  while (!options.signal.aborted) {
    let waitMs = options.pollMs;
    try {
      const job = await backend.claim(options.signal);
      if (job) {
        const start = Date.now();
        const outcome = await processJob(backend, job, options.signal);
        log({ event: "job_processed", jobId: job.id, outcome, durationMs: Date.now() - start });
        if (options.once) return;
        continue;
      }
      if (options.once) { log({ event: "worker_idle" }); return; }
    } catch {
      if (options.signal.aborted) break;
      log({ event: "worker_poll_failed" });
      if (options.once) throw new WorkerFault("worker_error");
      waitMs = Math.max(options.pollMs, 5_000);
    }
    await delay(waitMs, undefined, { signal: options.signal }).catch(() => {});
  }
}
