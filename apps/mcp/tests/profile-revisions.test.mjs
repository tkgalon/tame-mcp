import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProfileRegistry } from "../dist/profile-registry.js";
import { createMcpServer } from "../dist/server.js";

const principal = { ownerId: randomUUID(), clientId: randomUUID(), sessionId: randomUUID(), connectionId: randomUUID(), permissions: ["read_profiles", "write_profiles"] };
const payload = { schemaVersion: 1, name: "CTF", description: "Narrative", purpose: "Explain", usageConditions: { whenToUse: ["CTF"], whenNotToUse: [] },
  rules: [{ id: "facts", category: "factual", instruction: "Use supplied facts", strength: "required", origin: "product_default" }], evidence: [] };
const profile = { id: randomUUID(), name: "CTF", description: "Narrative", versionId: randomUUID(), versionNumber: 1, approvedAt: "2026-11-01T00:00:00Z", schemaVersion: 1, payload, approvalChannel: "chat", evidenceStatus: [] };
const input = { profileId: profile.id, baseVersionId: profile.versionId, draftId: randomUUID(), payload, preview: "Illustration", reason: "Explicit permanent preference" };
const draft = { id: input.draftId, status: "pending_review", schemaVersion: 1, payload, preview: input.preview, createdAt: profile.approvedAt, draftHash: "a".repeat(64), profileId: profile.id, baseVersionId: profile.versionId,
  changeReason: input.reason, changes: { fields: ["purpose"], rulesAdded: [], rulesRemoved: [], rulesChanged: [], evidenceChanged: false } };
const rollback = { profileId: profile.id, baseVersionId: randomUUID(), targetVersionId: profile.versionId, reason: "Restore previous style", approval: "user_requested", idempotencyKey: randomUUID() };
function fixture(change) {
  const calls = [];
  const registry = createProfileRegistry({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_fixture" }, async (url, init) => {
    const operation = url.split("/").at(-1), body = JSON.parse(init.body);
    calls.push({ operation, body });
    if (change) return change(operation);
    const values = {
      propose_mcp_profile_update: draft, get_mcp_profile_version: profile,
      list_mcp_profile_versions: { items: [{ versionId: profile.versionId, versionNumber: 1, approvedAt: profile.approvedAt, approvalChannel: "chat", changeReason: null, restoredFromVersionId: null }], nextBefore: null },
      rollback_mcp_profile: { draftId: rollback.idempotencyKey, draftHash: "b".repeat(64), profile: { ...profile, versionId: randomUUID(), versionNumber: 3, restoredFromVersionId: profile.versionId } },
    };
    return Response.json(values[operation]);
  });
  return { registry, calls };
}
test("revision operations bind base version, reason and verified identity", async () => {
  const { registry, calls } = fixture();
  assert.deepEqual(await registry.propose(principal, input), draft);
  assert.equal(calls[0].body.p_base_version_id, profile.versionId);
  assert.equal(calls[0].body.p_owner_id, principal.ownerId);
  assert.equal(calls[0].body.p_reason, input.reason);
  const restored = await registry.rollback(principal, rollback);
  assert.equal(restored.profile.restoredFromVersionId, profile.versionId);
  assert.deepEqual(calls.slice(1).map(call => call.operation), ["get_mcp_profile_version", "rollback_mcp_profile"]);
});
test("read-only access cannot propose or rollback and missing approval never reaches RPC", async () => {
  const { registry, calls } = fixture(), reader = { ...principal, permissions: ["read_profiles"] };
  await assert.rejects(registry.propose(reader, input), { code: "permission_denied" });
  await assert.rejects(registry.rollback(reader, rollback), { code: "permission_denied" });
  await assert.rejects(registry.rollback(principal, { ...rollback, approval: undefined }), { code: "invalid_request" });
  assert.equal(calls.length, 0);
});
test("conflicts are stable errors and mismatched history responses fail closed", async () => {
  const conflict = fixture(() => Response.json({ code: "22023", message: "version_conflict", details: "private SQL" }, { status: 400 }));
  await assert.rejects(conflict.registry.propose(principal, input), { code: "version_conflict" });
  const wrong = fixture(() => Response.json({ ...profile, versionId: randomUUID() }));
  await assert.rejects(wrong.registry.version(principal, { profileId: profile.id, versionId: profile.versionId }), { code: "profiles_unavailable" });
});
test("real SDK exposes revision, history and rollback tools with strict approval inputs", async () => {
  const { registry } = fixture(), server = createMcpServer(principal, {}, undefined, registry), client = new Client({ name: "revision-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    assert.equal((await client.callTool({ name: "propose_profile_update", arguments: input })).structuredContent.baseVersionId, profile.versionId);
    assert.equal((await client.callTool({ name: "list_profile_versions", arguments: { profileId: profile.id } })).structuredContent.items.length, 1);
    assert.equal((await client.callTool({ name: "get_profile_version", arguments: { profileId: profile.id, versionId: profile.versionId } })).structuredContent.versionId, profile.versionId);
    assert.equal((await client.callTool({ name: "rollback_profile", arguments: rollback })).structuredContent.profile.versionNumber, 3);
    assert.equal((await client.callTool({ name: "rollback_profile", arguments: { ...rollback, approval: false } })).isError, true);
  } finally { await client.close(); await server.close(); }
});
