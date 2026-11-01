import assert from "node:assert/strict";
import test from "node:test";
import { WorkerFault } from "../dist/backend.js";
import { processJob, runWorker } from "../dist/runner.js";
import { job, signal } from "./helpers.mjs";

function fixture(overrides = {}) {
  const calls = { finish: [], retry: [], download: 0 };
  const backend = {
    async claim() { return null; },
    async download() { calls.download++; return Buffer.from("hello"); },
    async finish(claimed, result) { calls.finish.push([claimed, result]); return true; },
    async retry(claimed, code, releaseSignal) { calls.retry.push([claimed, code, releaseSignal]); return true; },
    ...overrides,
  };
  return { backend, calls };
}

test("a job downloads, parses in a child process and persists the extraction", async () => {
  const { backend, calls } = fixture();
  assert.equal(await processJob(backend, job(), signal()), "completed");
  assert.equal(calls.finish[0][1].status, "ready");
  assert.equal(calls.finish[0][1].sections[0].content, "hello");
  assert.equal(calls.retry.length, 0);
});

test("permanent extraction errors are persisted rather than retried", async () => {
  const { backend, calls } = fixture({ async download() { return Buffer.from("     "); } });
  assert.equal(await processJob(backend, job(), signal()), "completed");
  assert.equal(calls.finish[0][1].errorCode, "empty_document");
  assert.equal(calls.retry.length, 0);
});

test("lost leases never trigger another write or a retry", async () => {
  const { backend, calls } = fixture({ async finish() { return false; } });
  assert.equal(await processJob(backend, job(), signal()), "lease_lost");
  assert.equal(calls.retry.length, 0);
});

test("transient failures release the current lease with stable error codes", async () => {
  for (const code of ["storage_unavailable", "parser_timeout", "parser_crashed"]) {
    const { backend, calls } = fixture({ async download() { throw new WorkerFault(code); } });
    assert.equal(await processJob(backend, job(), signal()), "retried");
    assert.equal(calls.retry[0][1], code);
    assert.equal(calls.finish.length, 0);
  }
});

test("size, hash, and parser version mismatches fail before parsing", async () => {
  for (const claimed of [job({ size_bytes: 6 }), job({ content_hash: "a".repeat(64) }), job({ parser_version: "obsolete-v1" })]) {
    const { backend, calls } = fixture();
    assert.equal(await processJob(backend, claimed, signal(), async () => { assert.fail("Parser must not be called"); }), "retried");
    assert.equal(calls.retry[0][1], "worker_error");
    assert.equal(calls.finish.length, 0);
  }
});

test("expired leases are skipped before touching Storage", async () => {
  const { backend, calls } = fixture();
  assert.equal(await processJob(backend, job({ lease_until: new Date(Date.now() - 1).toISOString() }), signal()), "lease_lost");
  assert.equal(calls.download, 0);
  assert.equal(calls.retry.length, 0);
});

test("shutdown releases a claimed job using a fresh request signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const { backend, calls } = fixture();
  assert.equal(await processJob(backend, job(), controller.signal), "retried");
  assert.equal(calls.download, 0);
  assert.equal(calls.retry[0][2].aborted, false);
});

test("unavailable retry endpoint leaves the lease for database recovery", async () => {
  const { backend } = fixture({ async download() { throw new Error("private payload"); }, async retry() { throw new Error("secret"); } });
  assert.equal(await processJob(backend, job(), signal()), "release_failed");
});

test("once mode processes one job and emits no document contents", async () => {
  const logs = [];
  let claims = 0;
  const { backend } = fixture({ async claim() { claims++; return job(); } });
  await runWorker(backend, { signal: signal(), pollMs: 2000, once: true, log: event => logs.push(event) });
  assert.equal(claims, 1);
  assert.equal(logs[0].outcome, "completed");
  assert.equal(JSON.stringify(logs).includes("hello"), false);
});

test("idle workers stop promptly without claiming again", async () => {
  const controller = new AbortController();
  let claims = 0;
  const { backend } = fixture({ async claim() { claims++; controller.abort(); return null; } });
  await runWorker(backend, { signal: controller.signal, pollMs: 30_000 });
  assert.equal(claims, 1);
});

test("once mode reports empty queues and fails if polling fails", async () => {
  const logs = [];
  await runWorker(fixture().backend, { signal: signal(), pollMs: 2000, once: true, log: event => logs.push(event) });
  assert.equal(logs[0].event, "worker_idle");
  await assert.rejects(runWorker(fixture({ async claim() { throw new Error("secret"); } }).backend, { signal: signal(), pollMs: 2000, once: true }), error => error.code === "worker_error");
});
