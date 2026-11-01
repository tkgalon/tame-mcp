import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProfileDraftRepository } from "../dist/profile-drafts.js";
import { createMcpServer } from "../dist/server.js";

const principal = { ownerId: randomUUID(), clientId: randomUUID(), sessionId: randomUUID(), connectionId: randomUUID(), permissions: ["read_profiles", "write_profiles", "read_examples"] };
function input() {
  return { draftId: randomUUID(), payload: { schemaVersion: 1, name: "CTF", description: "Narrative writeups", purpose: "Explain the investigation",
    usageConditions: { whenToUse: ["Narrative"], whenNotToUse: [] },
    rules: [{ id: "facts", category: "factual", instruction: "Do not invent command output", strength: "required", origin: "product_default" }], evidence: [] }, preview: "Illustration: [observed output]" };
}
function result(value) {
  return { id: value.draftId, payload: value.payload, preview: value.preview, schemaVersion: 1, status: "pending_review", draftHash: "a".repeat(64), createdAt: "2026-11-01T00:00:00Z" };
}
test("draft repository uses trusted identity and backend credentials with bounded RPC calls", async () => {
  const value = input();
  const calls = [];
  const repository = createProfileDraftRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, async (url, init) => {
    calls.push({ url, init }); return Response.json(result(value));
  });
  assert.deepEqual(await repository.create(principal, value), result(value));
  assert.deepEqual(await repository.get(principal, { draftId: value.draftId }), result(value));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.p_owner_id, principal.ownerId);
  assert.equal(body.p_client_id, principal.clientId);
  assert.equal(body.p_session_id, principal.sessionId);
  assert.deepEqual(body.p_payload, value.payload);
  assert.equal(calls[0].init.headers.apikey, "sb_secret_test");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});
test("missing permissions and invalid drafts never reach the backend", async () => {
  let calls = 0;
  const repository = createProfileDraftRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, async () => { calls++; throw new Error(); });
  const value = input();
  await assert.rejects(repository.create({ ...principal, permissions: ["read_profiles"] }, value), { code: "permission_denied" });
  await assert.rejects(repository.get({ ...principal, permissions: ["write_profiles"] }, { draftId: value.draftId }), { code: "permission_denied" });
  await assert.rejects(repository.create(principal, { ...value, ownerId: randomUUID() }), { code: "invalid_draft" });
  value.payload.rules[0].origin = "inferred";
  value.payload.evidence = [{ ruleId: "facts", documentId: randomUUID(), sectionId: randomUUID(), extractionVersion: 1, excerpt: "Evidence" }];
  await assert.rejects(repository.create({ ...principal, permissions: ["write_profiles"] }, value), { code: "permission_denied" });
  assert.equal(calls, 0);
});
test("draft errors are allowlisted and provider details stay private", async () => {
  for (const [body, status, expected] of [
    [{ code: "42501", message: "private table" }, 403, "permission_denied"],
    [{ code: "23505", message: "draft_conflict" }, 409, "draft_conflict"],
    [{ code: "22023", message: "invalid_evidence" }, 400, "invalid_evidence"],
    [{ code: "22023", message: "invalid_draft" }, 400, "invalid_draft"],
    [{ message: "private SQL details" }, 500, "profiles_unavailable"],
    [null, 200, "not_found"],
  ]) {
    const repository = createProfileDraftRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, async () => Response.json(body, { status }));
    await assert.rejects(repository.get(principal, { draftId: randomUUID() }), error => error.code === expected && !error.message.includes("private"));
  }
});
test("oversized, malformed and wrong-draft responses fail closed", async () => {
  for (const response of [new Response("x".repeat(128 * 1024 + 1)), new Response("invalid JSON"), Response.json(result(input()))]) {
    const repository = createProfileDraftRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, async () => response);
    await assert.rejects(repository.get(principal, { draftId: randomUUID() }), { code: "profiles_unavailable" });
  }
});
test("real SDK retrieves the authoring contract, saves and reloads a draft without activation", async () => {
  const value = input();
  let saved;
  const repository = createProfileDraftRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("create_mcp_profile_draft")) saved = result({ draftId: body.p_draft_id, payload: body.p_payload, preview: body.p_preview });
    return Response.json(saved ?? null);
  });
  const server = createMcpServer(principal, {}, repository);
  const client = new Client({ name: "profile-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const tools = await client.listTools();
    assert.equal(tools.tools.find(tool => tool.name === "create_profile_draft").annotations.readOnlyHint, false);
    const guide = await client.callTool({ name: "get_profile_authoring_guide", arguments: {} });
    assert.equal(guide.structuredContent.schemaVersion, 1);
    assert.ok(guide.structuredContent.createDraftInput.properties.payload.properties.rules);
    const draft = await client.callTool({ name: "create_profile_draft", arguments: value });
    assert.equal(draft.isError, undefined);
    assert.equal(draft.structuredContent.status, "pending_review");
    assert.deepEqual((await client.callTool({ name: "get_profile_draft", arguments: { draftId: value.draftId } })).structuredContent, draft.structuredContent);
    assert.equal((await client.callTool({ name: "create_profile_draft", arguments: { ...value, ownerId: randomUUID() } })).isError, true);
    value.payload.rules = Array.from({ length: 20 }, (_, index) => ({ ...value.payload.rules[0], id: `rule_${index}`, origin: "inferred" }));
    value.payload.evidence = value.payload.rules.flatMap(rule => [0, 1].map(index => ({ ruleId: rule.id, documentId: randomUUID(), sectionId: randomUUID(), extractionVersion: 1, excerpt: `Evidence ${index}` })));
    value.draftId = randomUUID();
    const full = await client.callTool({ name: "create_profile_draft", arguments: value });
    assert.equal(full.isError, undefined);
    assert.equal(full.structuredContent.payload.evidence.length, 40);
  } finally { await client.close(); await server.close(); }
});
