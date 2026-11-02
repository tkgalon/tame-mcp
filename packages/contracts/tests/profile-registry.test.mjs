import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { saveProfileVersionSchema, findProfilesSchema, activeProfileSchema } from "../dist/index.js";

test("publication requires the reviewed hash, explicit approval assertion and retry key", () => {
  const input = { draftId: randomUUID(), draftHash: "a".repeat(64), idempotencyKey: randomUUID(), approval: "user_requested" };
  assert.deepEqual(saveProfileVersionSchema.parse(input), input);
  for (const change of [{ approval: false }, { approval: undefined }, { draftHash: "invalid" }, { idempotencyKey: "" }, { ownerId: randomUUID() }]) {
    assert.equal(saveProfileVersionSchema.safeParse({ ...input, ...change }).success, false);
  }
});
test("profile search is bounded and defaults to the first page", () => {
  assert.deepEqual(findProfilesSchema.parse({}), { query: "", page: 1 });
  assert.equal(findProfilesSchema.parse({ query: " CTF " }).query, "CTF");
  for (const input of [{ page: 0 }, { page: 10001 }, { query: "x".repeat(121) }, { query: "\0" }]) {
    assert.equal(findProfilesSchema.safeParse(input).success, false);
  }
});
test("active versions require consistent snapshot identity and source status", () => {
  const profile = {
    id: randomUUID(), name: "CTF", description: "Narrative", versionId: randomUUID(), versionNumber: 1,
    approvedAt: "2026-11-01T00:00:00Z", schemaVersion: 1, approvalChannel: "chat", evidenceStatus: [],
    payload: { schemaVersion: 1, name: "CTF", description: "Narrative", purpose: "Explain", usageConditions: { whenToUse: ["CTF"], whenNotToUse: [] },
      rules: [{ id: "facts", category: "factual", instruction: "Use supplied facts", strength: "required", origin: "product_default" }], evidence: [] },
  };
  assert.equal(activeProfileSchema.safeParse(profile).success, true);
  assert.equal(activeProfileSchema.safeParse({ ...profile, name: "Other" }).success, false);
  assert.equal(activeProfileSchema.safeParse({ ...profile, evidenceStatus: [{ ruleId: "facts", documentId: randomUUID(), sectionId: randomUUID(), status: "available" }] }).success, false);
});
