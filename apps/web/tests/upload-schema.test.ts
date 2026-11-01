import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, uploadMetadataSchema } from "../lib/documents/upload-schema";

const base = { collectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "example.md", sizeBytes: 100 };

describe("document upload metadata", () => {
  it("derives canonical MIME types from supported extensions", () => {
    for (const [name, expected] of [
      ["writeup.PDF", "application/pdf"],
      ["writeup.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["writeup.txt", "text/plain"],
      ["writeup.md", "text/markdown"],
      ["writeup.markdown", "text/markdown"],
    ]) {
      expect(uploadMetadataSchema.parse({ ...base, name }).mediaType).toBe(expected);
    }
  });

  it("normalizes the display name and ignores client-supplied MIME or owner fields", () => {
    expect(uploadMetadataSchema.parse({ ...base, name: "  example.md  ", mediaType: "application/executable", ownerId: "forged" })).toEqual({
      ...base, mediaType: "text/markdown",
    });
  });

  it("enforces a nonempty file and the ten MiB boundary", () => {
    expect(uploadMetadataSchema.safeParse({ ...base, sizeBytes: MAX_DOCUMENT_BYTES }).success).toBe(true);
    for (const sizeBytes of [0, -1, 1.5, MAX_DOCUMENT_BYTES + 1, Infinity, NaN, "100"]) {
      expect(uploadMetadataSchema.safeParse({ ...base, sizeBytes }).success).toBe(false);
    }
  });

  it("rejects unsupported, disguised, or missing extensions", () => {
    for (const name of ["payload.exe", "writeup.pdf.exe", "file.constructor", "file.__proto__", "no-extension", "", "   "]) {
      expect(uploadMetadataSchema.safeParse({ ...base, name }).success).toBe(false);
    }
  });

  it("rejects paths, control characters, invalid collection IDs, and oversized names", () => {
    for (const name of ["../example.md", "folder/example.md", "folder\\example.md", "file\n.md", "x".repeat(253) + ".md"]) {
      expect(uploadMetadataSchema.safeParse({ ...base, name }).success).toBe(false);
    }
    expect(uploadMetadataSchema.safeParse({ ...base, collectionId: "invalid" }).success).toBe(false);
  });
});
