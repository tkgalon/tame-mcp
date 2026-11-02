import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { rollbackProfileSchema, listProfileVersionsSchema, proposeProfileUpdateSchema } from "../dist/index.js";

test("rollback requires an explicit target, concurrency base and approval assertion", () => {
  const input = { profileId: randomUUID(), targetVersionId: randomUUID(), baseVersionId: randomUUID(), idempotencyKey: randomUUID(), reason: "Restore previous preference", approval: "user_requested" };
  assert.deepEqual(rollbackProfileSchema.parse(input), input);
  for (const change of [{ baseVersionId: undefined }, { reason: " " }, { approval: false }, { ownerId: randomUUID() }]) {
    assert.equal(rollbackProfileSchema.safeParse({ ...input, ...change }).success, false);
  }
});
test("history continuation is bounded and revision proposals require full valid payloads", () => {
  assert.equal(listProfileVersionsSchema.safeParse({ profileId: randomUUID(), before: 0 }).success, false);
  assert.equal(listProfileVersionsSchema.safeParse({ profileId: randomUUID(), before: 20 }).success, true);
  assert.equal(proposeProfileUpdateSchema.safeParse({ profileId: randomUUID(), baseVersionId: randomUUID(), payload: {} }).success, false);
});
