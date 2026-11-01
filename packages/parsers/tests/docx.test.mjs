import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { parseDocxDocument } from "../dist/docx.js";
import { MAX_DOCX_ENTRIES, MAX_DOCX_ENTRY_BYTES, MAX_DOCX_EXPANDED_BYTES } from "../dist/docx-archive.js";

function docx(body, extra = {}, options = {}) {
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`),
    ...extra,
  }, options);
}

const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const heading = (level, text) => `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const validate = result => extractionResultSchema.parse(result);

test("DOCX extracts headings, Unicode, paragraphs and table text without page guesses", async () => {
  const bytes = docx(heading(1, "CTF Narasi") + paragraph("Temuan 😀") + heading(2, "Evidence") +
    '<w:tbl><w:tr><w:tc>' + paragraph("Question") + '</w:tc><w:tc>' + paragraph("Answer") + '</w:tc></w:tr></w:tbl>');
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "ready");
  assert.equal(result.contentHash, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(result.sections.map(section => section.heading), ["CTF Narasi", "Evidence"]);
  assert.ok(result.sections.every(section => section.page === null));
  assert.match(result.sections[0].content, /Temuan 😀/);
  assert.match(result.sections[1].content, /Question[\s\S]*Answer/);
  assert.deepEqual(await parseDocxDocument(bytes), result);
});

test("DOCX preserves numbered question labels and literal code-like content", async () => {
  const result = validate(await parseDocxDocument(docx(paragraph("1. What is the flag?") + paragraph("  print(&quot;flag&quot;)  "))));
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /1\. What is the flag\?/);
  assert.match(result.sections[0].content, /  print\("flag"\)  /);
});

test("DOCX extracts real Word numbering as ordered list markers", async () => {
  const question = text => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const numbering = '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const result = validate(await parseDocxDocument(docx(question("First question") + question("Second question"), { "word/numbering.xml": strToU8(numbering) })));
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /1\. First question\n2\. Second question/);
});

test("DOCX hyperlinks are plain labels and never fetched or rendered", async () => {
  const body = '<w:p><w:hyperlink r:id="link"><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:hyperlink></w:p>';
  const bytes = docx(body, { "word/_rels/document.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://127.0.0.1:1/private" TargetMode="External"/></Relationships>') });
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /<script>alert\(1\)<\/script>/);
});

test("DOCX rejects empty, corrupt, wrong-format and oversized inputs", async () => {
  for (const [bytes, code] of [
    [docx(""), "empty_document"],
    [Buffer.from("PK broken archive"), "invalid_document"],
    [zipSync({ "unrelated.txt": strToU8("secret") }), "invalid_document"],
    [Buffer.from("plain text"), "format_mismatch"],
    [new Uint8Array(MAX_DOCUMENT_BYTES + 1), "file_too_large"],
  ]) {
    const result = validate(await parseDocxDocument(bytes));
    assert.equal(result.errorCode, code);
    assert.equal("sections" in result, false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("DOCX rejects archive entry-count and expanded-size overflow before conversion", async () => {
  const many = Object.fromEntries(Array.from({ length: MAX_DOCX_ENTRIES }, (_, index) => [`extra/${index}`, new Uint8Array()]));
  const oversized = { "huge.xml": new Uint8Array(MAX_DOCX_ENTRY_BYTES + 1) };
  const total = Object.fromEntries(Array.from({ length: MAX_DOCX_EXPANDED_BYTES / MAX_DOCX_ENTRY_BYTES + 1 }, (_, index) => [`large/${index}`, new Uint8Array(MAX_DOCX_ENTRY_BYTES)]));
  for (const extra of [many, oversized, total]) {
    const result = validate(await parseDocxDocument(docx(paragraph("small"), extra)));
    assert.equal(result.errorCode, "archive_limit_exceeded");
  }
});

test("DOCX rejects path traversal and repeated entry names", async () => {
  const traversal = docx(paragraph("safe"), { "../escape": strToU8("bad") });
  assert.equal((await parseDocxDocument(traversal)).errorCode, "invalid_document");
  const repeated = Buffer.from(docx(paragraph("safe"), { "duplicate1": strToU8("one"), "duplicate2": strToU8("two") }, { level: 0 }));
  for (let offset = repeated.indexOf("duplicate2"); offset !== -1; offset = repeated.indexOf("duplicate2", offset + 1)) repeated.write("duplicate1", offset);
  assert.equal((await parseDocxDocument(repeated)).errorCode, "invalid_document");
});

test("DOCX rejects inconsistent expanded sizes instead of trusting ZIP metadata", async () => {
  const bytes = Buffer.from(docx(paragraph("x".repeat(100_000))));
  let offset = 0;
  while ((offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 46, offset + 46 + length).toString() === "word/document.xml") {
      bytes.writeUInt32LE(1, offset + 24);
      break;
    }
    offset += 4;
  }
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "invalid_document");
});

test("DOCX encrypted ZIP entries require a password", async () => {
  const bytes = Buffer.from(docx(paragraph("private")));
  const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 1, offset + 8);
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.errorCode, "password_required");
});

test("DOCX text overflow never returns partial sections", async () => {
  const result = validate(await parseDocxDocument(docx(paragraph("x".repeat(100_001)))));
  assert.equal(result.errorCode, "text_limit_exceeded");
  assert.equal("sections" in result, false);
});

test("DOCX ignores external images and reports their omission without opening them", async () => {
  const body = '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="image" descr="Evidence screenshot"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:link="image1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const bytes = docx(paragraph("Finding") + body, { "word/_rels/document.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///private/nonexistent-secret.png" TargetMode="External"/></Relationships>') });
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "ready");
  assert.ok(result.warnings.includes("images_not_extracted"));
  assert.match(result.sections[0].content, /Finding/);
});
