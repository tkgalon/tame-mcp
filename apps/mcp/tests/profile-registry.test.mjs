import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProfileRegistry } from "../dist/profile-registry.js";
import { createMcpServer } from "../dist/server.js";

const principal = { ownerId: randomUUID(), clientId: randomUUID(), sessionId: randomUUID(), connectionId: randomUUID(), permissions: ["read_profiles", "write_profiles", "read_examples"] };
const payload = { schemaVersion: 1, name: "CTF", description: "Narrative", purpose: "Explain the solution",
  usageConditions: { whenToUse: ["Narrative"], whenNotToUse: [] },
  rules: [{ id: "facts", category: "factual", instruction: "Use only provided facts", strength: "required", origin: "product_default" }], evidence: [] };
const draft = { id: randomUUID(), status: "pending_review", schemaVersion: 1, payload, preview: "Illustration", draftHash: "a".repeat(64), createdAt: "2026-11-01T00:00:00Z" };
const profile = { id: randomUUID(), name: payload.name, description: payload.description, versionId: randomUUID(), versionNumber: 1,
  schemaVersion: 1, payload, approvedAt: draft.createdAt, approvalChannel: "chat", evidenceStatus: [] };
const publication = { draftId: draft.id, draftHash: draft.draftHash, idempotencyKey: randomUUID(), approval: "user_requested" };
const saved = { draftId: draft.id, draftHash: draft.draftHash, profile };
const summary = { id: profile.id, name: profile.name, description: profile.description, versionId: profile.versionId, versionNumber: 1, approvedAt: profile.approvedAt };
function fixture(override) {
  const calls = [];
  const registry = createProfileRegistry({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_fixture" }, async (url, init) => {
    const body = JSON.parse(init.body), operation = url.split("/").at(-1);
    calls.push({ operation, body, init });
    if (override) return override(operation, body);
    const values = { get_mcp_profile_draft: draft, save_mcp_profile_version: saved, get_mcp_profile: profile, find_mcp_profiles: { items: [summary], nextPage: null } };
    return Response.json(values[operation]);
  });
  return { registry, calls };
}
test("registry validates stored drafts before publishing and binds every call to verified identity", async () => {
  const { registry, calls } = fixture();
  assert.deepEqual(await registry.save(principal, publication), saved);
  assert.deepEqual(calls.map(call => call.operation), ["get_mcp_profile_draft", "save_mcp_profile_version"]);
  for (const { body, init } of calls) {
    assert.equal(body.p_owner_id, principal.ownerId);
    assert.equal(body.p_client_id, principal.clientId);
    assert.equal(body.p_session_id, principal.sessionId);
    assert.equal(init.headers.apikey, "sb_secret_fixture");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "error");
  }
  assert.equal(calls[1].body.p_approval, "user_requested");
  assert.equal(calls[1].body.p_idempotency_key, publication.idempotencyKey);
});
test("missing permissions, approval or a mismatched hash prevent publication", async () => {
  const { registry, calls } = fixture();
  await assert.rejects(registry.save({ ...principal, permissions: ["read_profiles"] }, publication), { code: "permission_denied" });
  await assert.rejects(registry.get({ ...principal, permissions: ["write_profiles"] }, { profileId: profile.id }), { code: "permission_denied" });
  await assert.rejects(registry.find({ ...principal, permissions: ["write_profiles"] }, {}), { code: "permission_denied" });
  await assert.rejects(registry.save(principal, { ...publication, approval: undefined }), { code: "invalid_request" });
  assert.equal(calls.length, 0);
  await assert.rejects(registry.save(principal, { ...publication, draftHash: "b".repeat(64) }), { code: "draft_changed" });
  assert.equal(calls.length, 1);
});
test("search forwards bounded literal queries while profile IDs and pagination are validated", async () => {
  const { registry, calls } = fixture();
  assert.deepEqual(await registry.find(principal, { query: " CTF%_ " }), { items: [summary], nextPage: null });
  assert.equal(calls[0].body.p_query, "CTF%_");
  assert.equal(calls[0].body.p_page, 1);
  assert.deepEqual(await registry.get(principal, { profileId: profile.id }), profile);
  const invalid = fixture(operation => Response.json(operation === "find_mcp_profiles" ? { items: [], nextPage: 99 } : { ...profile, id: randomUUID() }));
  await assert.rejects(invalid.registry.get(principal, { profileId: profile.id }), { code: "profiles_unavailable" });
  await assert.rejects(invalid.registry.find(principal, {}), { code: "profiles_unavailable" });
});
test("missing profiles and publication errors return stable codes without provider details", async () => {
  await assert.rejects(fixture(() => Response.json(null)).registry.get(principal, { profileId: profile.id }), { code: "not_found" });
  for (const [code, sqlCode] of [["idempotency_conflict", "23505"], ["draft_not_pending", "22023"], ["draft_changed", "22023"], ["invalid_evidence", "22023"]]) {
    const { registry } = fixture(operation => operation === "get_mcp_profile_draft" ? Response.json(draft) : Response.json({ code: sqlCode, message: code, details: "private SQL" }, { status: 400 }));
    await assert.rejects(registry.save(principal, publication), error => error.code === code && !error.message.includes("private"));
  }
});
test("real MCP SDK can publish v1, find and retrieve it with no approval bypass", async () => {
  const { registry } = fixture();
  const server = createMcpServer(principal, {}, undefined, registry), client = new Client({ name: "registry-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const tools = await client.listTools();
    assert.equal(tools.tools.find(tool => tool.name === "save_profile_version").annotations.readOnlyHint, false);
    assert.equal((await client.callTool({ name: "save_profile_version", arguments: { ...publication, approval: false } })).isError, true);
    const result = await client.callTool({ name: "save_profile_version", arguments: publication });
    assert.deepEqual(result.structuredContent, saved);
    assert.deepEqual((await client.callTool({ name: "find_profiles", arguments: {} })).structuredContent.items, [summary]);
    assert.deepEqual((await client.callTool({ name: "get_profile", arguments: { profileId: profile.id } })).structuredContent, profile);
  } finally { await client.close(); await server.close(); }
});
