import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createProfileDraftSchema, taskProfileSchema } from "../dist/index.js";

function profile() {
  return { schemaVersion: 1, name: "CTF Narasi", description: "Writeups", purpose: "Explain the reasoning behind a solution",
    usageConditions: { whenToUse: ["Narrative writeups"], whenNotToUse: ["Question by question responses"] },
    rules: [{ id: "reason_first", category: "style", instruction: "Explain the reason before commands", strength: "preferred", origin: "inferred" }],
    evidence: [{ ruleId: "reason_first", documentId: randomUUID(), sectionId: randomUUID(), extractionVersion: 1, excerpt: "Karena itu" }] };
}
test("task profiles retain flexible rules and source evidence with normalized identities", () => {
  const input = profile();
  input.evidence[0].documentId = input.evidence[0].documentId.toUpperCase();
  assert.equal(taskProfileSchema.parse(input).evidence[0].documentId, input.evidence[0].documentId.toLowerCase());
  assert.equal(createProfileDraftSchema.parse({ draftId: randomUUID(), payload: input, preview: "Illustrative preview" }).payload.rules.length, 1);
});
test("inferred rules need evidence while tentative rules remain non-mandatory", () => {
  const input = profile();
  input.evidence = [];
  assert.equal(taskProfileSchema.safeParse(input).success, false);
  input.rules[0].origin = "unconfirmed";
  assert.equal(taskProfileSchema.safeParse(input).success, true);
  input.rules[0].strength = "required";
  assert.equal(taskProfileSchema.safeParse(input).success, false);
});
test("rule identities and evidence references are unambiguous", () => {
  for (const mutate of [
    value => value.rules.push({ ...value.rules[0] }),
    value => value.evidence[0].ruleId = "missing",
    value => value.evidence.push({ ...value.evidence[0] }),
    value => value.rules[0].origin = "invented",
    value => value.evidence[0].extractionVersion = 0,
    value => value.ownerId = randomUUID(),
  ]) {
    const input = profile(); mutate(input);
    assert.equal(taskProfileSchema.safeParse(input).success, false);
  }
});
test("drafts reject oversized UTF-8 payloads, unknown fields and empty text", () => {
  const payload = profile();
  payload.rules = Array.from({ length: 20 }, (_, index) => ({ ...payload.rules[0], id: `rule_${index}`, instruction: "界".repeat(1000), origin: "user_stated" }));
  payload.evidence = [];
  assert.equal(createProfileDraftSchema.safeParse({ draftId: randomUUID(), payload, preview: "" }).success, false);
  assert.equal(createProfileDraftSchema.safeParse({ draftId: randomUUID(), payload: profile(), preview: "", ownerId: randomUUID() }).success, false);
  payload.name = "   ";
  assert.equal(taskProfileSchema.safeParse(payload).success, false);
});
