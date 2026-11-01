import assert from "node:assert/strict";
import test from "node:test";
import { readWorkerConfig } from "../dist/config.js";

const key = role => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
const env = { TAME_SUPABASE_URL: "http://127.0.0.1:54321", TAME_SUPABASE_SECRET_KEY: "sb_secret_test-only" };

test("worker accepts secret keys and legacy service-role keys with bounded polling", () => {
  assert.equal(readWorkerConfig(env).pollMs, 2000);
  assert.equal(readWorkerConfig({ ...env, TAME_SUPABASE_SECRET_KEY: key("service_role") }).secretKey, key("service_role"));
  assert.equal(readWorkerConfig({ ...env, TAME_SUPABASE_URL: "https://project.supabase.co" }).supabaseUrl, "https://project.supabase.co");
});

test("worker rejects public credentials, malformed URLs, and invalid configuration", () => {
  for (const value of ["", "sb_publishable_public", key("anon"), key("authenticated"), "invalid"]) {
    assert.equal(readWorkerConfig({ ...env, TAME_SUPABASE_SECRET_KEY: value }), null);
  }
  for (const url of ["http://remote.example", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=secret", "https://example.com/#secret"]) {
    assert.equal(readWorkerConfig({ ...env, TAME_SUPABASE_URL: url }), null);
  }
  for (const pollMs of ["0", "249", "30001", "abc"]) assert.equal(readWorkerConfig({ ...env, TAME_WORKER_POLL_MS: pollMs }), null);
  assert.equal(readWorkerConfig({}), null);
});
