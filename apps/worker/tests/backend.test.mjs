import assert from "node:assert/strict";
import test from "node:test";
import { createBackend, claimedJobSchema, WorkerFault } from "../dist/backend.js";
import { job, signal } from "./helpers.mjs";

const config = { supabaseUrl: "http://127.0.0.1:54321", secretKey: "sb_secret_test-only", pollMs: 2000 };
const json = value => Response.json(value);

test("claim uses fixed RPC, secret apikey, explicit lease, and no redirects", async () => {
  const expected = job();
  const backend = createBackend(config, async (url, init) => {
    assert.equal(url, `${config.supabaseUrl}/rest/v1/rpc/claim_document_job`);
    assert.equal(init.headers.apikey, config.secretKey);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), { p_lease_seconds: 120 });
    return json(expected);
  });
  assert.deepEqual(await backend.claim(signal()), expected);
  assert.equal(await createBackend(config, async () => json(null)).claim(signal()), null);
});

test("claim rejects storage paths outside the claimed owner's document", async () => {
  const invalid = job({ storage_path: "../../other/secret" });
  assert.equal(claimedJobSchema.safeParse(invalid).success, false);
  await assert.rejects(createBackend(config, async () => json(invalid)).claim(signal()), WorkerFault);
});

test("legacy service-role credentials supply bearer authorization", async () => {
  await createBackend({ ...config, secretKey: "legacy.jwt.signature" }, async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer legacy.jwt.signature");
    return json(null);
  }).claim(signal());
});

test("download streams registered bytes from the private bucket", async () => {
  const backend = createBackend(config, async (url, init) => {
    assert.equal(url, `${config.supabaseUrl}/storage/v1/object/authenticated/documents/${job().storage_path}`);
    assert.equal(init.redirect, "error");
    return new Response("hello");
  });
  assert.equal(Buffer.from(await backend.download(job(), signal())).toString(), "hello");
});

test("download rejects declared and streamed overflow, incomplete objects, and HTTP failures", async () => {
  const bodies = [
    () => new Response("hello!", { headers: { "Content-Length": "6" } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("hello!")); controller.close(); } })),
    () => new Response("hi"), () => new Response("private upstream body", { status: 503 }),
  ];
  for (const response of bodies) {
    await assert.rejects(createBackend(config, async () => response()).download(job(), signal()), error => {
      assert.ok(error instanceof WorkerFault);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
});

test("RPC responses are bounded and upstream errors stay private", async () => {
  for (const response of [() => new Response("private data", { status: 500 }), () => new Response("x".repeat(65537)), () => new Response("not JSON")]) {
    await assert.rejects(createBackend(config, async () => response()).claim(signal()), error => error.message === "worker_error");
  }
});

test("finish and retry carry the lease token and preserve false responses", async () => {
  const requests = [];
  const backend = createBackend(config, async (url, init) => { requests.push([url, JSON.parse(init.body)]); return json(false); });
  const result = { status: "failed", contentHash: "a".repeat(64), parserVersion: "plain-text-v1", warnings: [], errorCode: "empty_document" };
  const claimed = job();
  assert.equal(await backend.finish(claimed, result, signal()), false);
  assert.equal(await backend.retry(claimed, "parser_timeout", signal()), false);
  assert.deepEqual(requests[0][1], { p_job_id: claimed.id, p_lease_token: claimed.lease_token, p_result: result });
  assert.equal(requests[1][1].p_error_code, "parser_timeout");
  await assert.rejects(createBackend(config, async () => json({ accepted: true })).finish(claimed, result, signal()), WorkerFault);
});
