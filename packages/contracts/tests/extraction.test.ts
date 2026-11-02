import assert from "node:assert/strict";
import { test } from "vitest";
import { extractionResultSchema, MAX_SECTION_CHARACTERS } from "../src/index";

const base = { contentHash: "a".repeat(64), parserVersion: "plain-text-v1", warnings: [] };
const section = { ordinal: 0, heading: null, page: null, content: "hello", sourceStart: 0, sourceEnd: 5 };

test("ready results require usable sections", () => {
  assert.equal(
    extractionResultSchema.safeParse({ ...base, status: "ready", sections: [section] }).success,
    true,
  );
  assert.equal(extractionResultSchema.safeParse({ ...base, status: "ready", sections: [] }).success, false);
});

test("failures cannot contain partial extracted sections", () => {
  assert.equal(
    extractionResultSchema.safeParse({ ...base, status: "failed", errorCode: "invalid_utf8" }).success,
    true,
  );
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      status: "failed",
      errorCode: "invalid_utf8",
      sections: [section],
    }).success,
    false,
  );
});

test("section offsets and ordinals must be contiguous", () => {
  assert.equal(
    extractionResultSchema.safeParse({ ...base, status: "ready", sections: [{ ...section, sourceEnd: 4 }] })
      .success,
    false,
  );
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      status: "ready",
      sections: [section, { ...section, ordinal: 2, sourceStart: 6, sourceEnd: 11 }],
    }).success,
    false,
  );
});

test("section limits count Unicode code points without splitting surrogate pairs", () => {
  const content = "😀".repeat(MAX_SECTION_CHARACTERS);
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      status: "ready",
      sections: [{ ...section, content, sourceEnd: content.length }],
    }).success,
    true,
  );
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      status: "ready",
      sections: [{ ...section, content: content + "x", sourceEnd: content.length + 1 }],
    }).success,
    false,
  );
});

test("hashes and machine-readable failures are validated", () => {
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      contentHash: "not-a-hash",
      status: "unsupported",
      errorCode: "unsupported_media_type",
    }).success,
    false,
  );
  assert.equal(
    extractionResultSchema.safeParse({ ...base, status: "failed", errorCode: "arbitrary private message" })
      .success,
    false,
  );
});

test("sections cannot contain NUL characters that PostgreSQL text cannot store", () => {
  assert.equal(
    extractionResultSchema.safeParse({
      ...base,
      status: "ready",
      sections: [{ ...section, content: "a\0b", sourceEnd: 3 }],
    }).success,
    false,
  );
});

test("OCR candidates have no partial sections and require the explicit reason", () => {
  const result = { ...base, status: "needs_ocr", errorCode: "no_extractable_text" };
  assert.equal(extractionResultSchema.safeParse(result).success, true);
  assert.equal(extractionResultSchema.safeParse({ ...result, sections: [section] }).success, false);
  assert.equal(extractionResultSchema.safeParse({ ...result, errorCode: "invalid_document" }).success, false);
});
