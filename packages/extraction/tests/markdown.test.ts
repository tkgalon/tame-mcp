import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { extractionResultSchema, MAX_EXTRACTION_SECTIONS, MAX_HEADING_CHARACTERS } from "@tame/contracts";
import { parseMarkdownDocument } from "../src/markdown";

const bytes = (value) => new TextEncoder().encode(value);
const content = (result) => result.sections.map((section) => section.content).join("");

test("extracts heading hierarchy and preserves all narrative and Q&A source", () => {
  const input =
    "Introduction\n\n# Challenge\n\nOverview\n\n## Question 1\n\nAnswer\n\n### Evidence\n\nOutput\n\n## Question 2\n\nNext answer\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal(content(result), input);
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    [
      null,
      "Challenge",
      "Challenge / Question 1",
      "Challenge / Question 1 / Evidence",
      "Challenge / Question 2",
    ],
  );
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("does not interpret fenced code as headings", () => {
  const input = "# Write-up\n\n```sh\n# shell comment\necho '## not a heading'\n```\n\n## Result\n\nDone\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal(result.sections.length, 2);
  assert.equal(content(result), input);
});

test("recognizes Setext headings and inline formatting", () => {
  const input = "Challenge\n=========\n\nIntro\n\nQuestion **one**\n---------------\n\nAnswer\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    ["Challenge", "Challenge / Question one"],
  );
  assert.equal(content(result), input);
});

test("preserves tables, lists, links, and image references without network access", () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("Unexpected network access");
  });
  const input =
    "# Evidence\n\n| Step | Result |\n| --- | --- |\n| 1 | OK |\n\n1. Run `file challenge`\n2. Check [reference](https://example.invalid)\n\n![screenshot](https://example.invalid/image.png)\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal(content(result), input);
  assert.ok(result.warnings.includes("images_not_extracted"));
  assert.equal(fetch.mock.calls.length, 0);
  fetch.mockRestore();
});

test("keeps HTML as source text and never evaluates it", () => {
  const input = "# Example\n\n<script>globalThis.__tame_parser_executed = true</script>\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal(content(result), input);
  assert.ok(result.warnings.includes("html_preserved"));
  assert.equal(globalThis.__tame_parser_executed, undefined);
});

test("shortens oversized heading metadata while preserving full source", () => {
  const input = "# " + "😀".repeat(MAX_HEADING_CHARACTERS + 1) + "\n\nBody\n";
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "ready");
  assert.equal([...result.sections[0].heading].length, MAX_HEADING_CHARACTERS);
  assert.equal(content(result), input);
  assert.ok(result.warnings.includes("heading_shortened"));
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("rejects too many sections without returning partial extraction", () => {
  const input = Array.from({ length: MAX_EXTRACTION_SECTIONS + 1 }, (_, index) => `# Part ${index}\n`).join(
    "",
  );
  const result = parseMarkdownDocument(bytes(input));
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "section_limit_exceeded");
  assert.equal(result.sections, undefined);
  assert.equal(result.text, undefined);
  assert.ok(extractionResultSchema.safeParse(result).success);
});

test("uses the same encoding and emptiness checks as plain text", () => {
  assert.equal(parseMarkdownDocument(bytes(" \n ")).errorCode, "empty_document");
  assert.equal(parseMarkdownDocument(new Uint8Array([0xff])).errorCode, "invalid_utf8");
});

test("does not carry headings or warnings between documents", () => {
  parseMarkdownDocument(bytes("# First\n\n![image](https://example.invalid/image.png)\n"));
  const result = parseMarkdownDocument(bytes("# Second\n\nNew document\n"));
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    ["Second"],
  );
  assert.deepEqual(result.warnings, []);
});
