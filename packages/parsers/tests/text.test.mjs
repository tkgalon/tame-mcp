import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractionResultSchema, MAX_DOCUMENT_BYTES, MAX_EXTRACTED_CHARACTERS, MAX_SECTION_CHARACTERS } from "@tame/contracts";
import { parseTextDocument } from "../dist/text.js";

const bytes = value => new TextEncoder().encode(value);
const content = result => result.sections.map(section => section.content).join("");

test("normalizes UTF-8 BOM and line endings without changing code indentation", () => {
  const original = bytes('\ufeffWrite-up\r\n\r\n\tprintf "hello"  \r\n');
  const result = parseTextDocument(original);
  assert.equal(result.status, "ready");
  assert.equal(content(result), 'Write-up\n\n\tprintf "hello"  \n');
  assert.equal(result.contentHash, createHash("sha256").update(original).digest("hex"));
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("rejects invalid UTF-8 rather than inserting replacement characters", () => {
  const result = parseTextDocument(new Uint8Array([0xc3, 0x28]));
  assert.equal(result.errorCode, "invalid_utf8");
  assert.equal(result.sections, undefined);
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("rejects binary controls and mislabeled PDF content", () => {
  assert.equal(parseTextDocument(bytes("hello\0world")).errorCode, "binary_content");
  assert.equal(parseTextDocument(bytes("%PDF-1.7\nASCII PDF content")).errorCode, "format_mismatch");
});

test("reports empty input without producing sections", () => {
  for (const input of [new Uint8Array(), bytes(" \n\t ")]) {
    const result = parseTextDocument(input);
    assert.equal(result.errorCode, "empty_document");
    assert.equal(result.sections, undefined);
  }
});

test("enforces byte and extracted-character limits without partial output", () => {
  assert.equal(parseTextDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1)).errorCode, "file_too_large");
  const overLimit = parseTextDocument(bytes("a".repeat(MAX_EXTRACTED_CHARACTERS + 1)));
  assert.equal(overLimit.errorCode, "text_limit_exceeded");
  assert.equal(overLimit.sections, undefined);
  const exact = parseTextDocument(bytes("a".repeat(MAX_EXTRACTED_CHARACTERS)));
  assert.equal(exact.status, "ready");
  assert.equal(content(exact).length, MAX_EXTRACTED_CHARACTERS);
  assert.ok(extractionResultSchema.safeParse(exact).success);
});

test("splits long Unicode content on code-point boundaries with contiguous offsets", () => {
  const input = "a".repeat(MAX_SECTION_CHARACTERS - 1) + "😀" + "tail";
  const result = parseTextDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal(content(result), input);
  assert.equal([...result.sections[0].content].length, MAX_SECTION_CHARACTERS);
  assert.equal(result.sections[0].sourceEnd, MAX_SECTION_CHARACTERS + 1);
  assert.ok(result.warnings.includes("section_split"));
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("preserves whitespace and stable section order across repeated parses", () => {
  const input = "intro\n\n" + "command output  \n".repeat(800);
  const result = parseTextDocument(bytes(input));
  assert.equal(content(result), input);
  assert.deepEqual(parseTextDocument(bytes(input)), result);
  assert.ok(result.sections.every(section => [...section.content].length <= MAX_SECTION_CHARACTERS));
});
