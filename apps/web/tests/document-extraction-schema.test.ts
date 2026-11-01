import { expect, it } from "vitest";
import { documentDetailSchema, documentSectionSchema, sectionQuerySchema } from "../lib/documents/schema";

const section = { id: "11111111-1111-4111-8111-111111111111", document_id: "22222222-2222-4222-8222-222222222222", extraction_version: 1, ordinal: 0, heading: null, page: null, content: "😀", source_start: 0, source_end: 2 };

it("preserves Unicode source offsets and supports legacy sections without offsets", () => {
  expect(documentSectionSchema.safeParse(section).success).toBe(true);
  expect(documentSectionSchema.safeParse({ ...section, source_start: null, source_end: null }).success).toBe(true);
  expect(documentSectionSchema.safeParse({ ...section, source_start: null }).success).toBe(false);
  expect(documentSectionSchema.safeParse({ ...section, source_end: 1 }).success).toBe(false);
});

it("enforces shared section limits and rejects NUL text", () => {
  expect(documentSectionSchema.safeParse({ ...section, content: "x".repeat(8001), source_end: 8001 }).success).toBe(false);
  expect(documentSectionSchema.safeParse({ ...section, content: "\0", source_end: 1 }).success).toBe(false);
  expect(documentSectionSchema.safeParse({ ...section, ordinal: 1000 }).success).toBe(false);
});

it("requires a version when continuing and accepts ordinal zero", () => {
  expect(sectionQuerySchema.parse({})).toEqual({});
  expect(sectionQuerySchema.parse({ version: "1", after: "0" })).toEqual({ version: 1, after: 0 });
  for (const query of [{ after: "1" }, { version: "0" }, { version: "1", after: "" }, { version: "1e0" }, { version: "1", after: "1000" }, { version: "2147483648" }]) {
    expect(sectionQuerySchema.safeParse(query).success).toBe(false);
  }
});

it("accepts worker failure codes without permitting raw provider messages", () => {
  const document = { id: section.document_id, collection_id: section.id, name: "example.md", media_type: "text/markdown", size_bytes: 10, status: "failed", created_at: "2026-11-01T08:00:00Z", extraction_version: 1, content_hash: null, parser_version: null, warnings: [], extraction_error_code: "lease_expired" };
  expect(documentDetailSchema.safeParse(document).success).toBe(true);
  expect(documentDetailSchema.safeParse({ ...document, extraction_error_code: "private raw stack trace" }).success).toBe(false);
});
