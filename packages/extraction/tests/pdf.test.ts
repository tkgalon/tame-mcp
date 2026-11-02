import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { PDFDocument, StandardFonts, PDFName, PDFNumber, PDFHexString } from "pdf-lib";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { parsePdfDocument, MAX_PDF_PAGES } from "../src/pdf";

async function pdf(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const content of pages) {
    const page = document.addPage();
    if (content) page.drawText(content, { font, x: 50, y: 700, size: 12 });
    else page.drawRectangle({ x: 50, y: 50, width: 50, height: 50 });
  }
  return document.save({ useObjectStreams: false });
}

function validate(result) {
  extractionResultSchema.parse(result);
  return result;
}

test("PDF extracts text with original page numbers, hash, and contiguous offsets", async () => {
  const bytes = await pdf(["CTF Narasi\nFirst finding", "Proof and conclusion"]);
  const original = Uint8Array.from(bytes);
  const result = validate(await parsePdfDocument(bytes));
  assert.equal(result.status, "ready");
  assert.equal(result.contentHash, createHash("sha256").update(original).digest("hex"));
  assert.deepEqual(bytes, original);
  assert.deepEqual(
    result.sections.map((section) => section.page),
    [1, 2],
  );
  assert.match(result.sections[0].content, /CTF Narasi\nFirst finding/);
  assert.match(result.sections[1].content, /Proof and conclusion/);
  assert.ok(result.warnings.includes("layout_approximate"));
  assert.deepEqual(await parsePdfDocument(bytes), result);
});

test("PDF without a text layer is an OCR candidate, including blank/vector pages", async () => {
  const result = validate(await parsePdfDocument(await pdf([null])));
  assert.equal(result.status, "needs_ocr");
  assert.equal(result.errorCode, "no_extractable_text");
  assert.equal("sections" in result, false);
});

test("image-only PDF is an OCR candidate without attempting to decode its pixels", async () => {
  const document = await PDFDocument.create();
  const image = await document.embedPng(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  document.addPage().drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
  const result = validate(await parsePdfDocument(await document.save()));
  assert.equal(result.status, "needs_ocr");
});

test("mixed PDF keeps original page numbers and warns about pages without text", async () => {
  const result = validate(await parsePdfDocument(await pdf([null, "Readable page", null])));
  assert.equal(result.status, "ready");
  assert.equal(result.sections[0].page, 2);
  assert.ok(result.warnings.includes("pages_without_text"));
});

test("PDF rejects malformed inputs and oversized files without leaking exceptions", async () => {
  for (const [bytes, code] of [
    [Buffer.from("plain text"), "format_mismatch"],
    [Buffer.from("%PDF-1.7\ninvalid private content"), "invalid_document"],
    [new Uint8Array(MAX_DOCUMENT_BYTES + 1), "file_too_large"],
  ]) {
    const result = validate(await parsePdfDocument(bytes));
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, code);
    assert.equal("sections" in result, false);
    assert.equal(JSON.stringify(result).includes("private content"), false);
  }
});

test("PDF refuses page counts above the processing budget", async () => {
  const result = validate(await parsePdfDocument(await pdf(Array(MAX_PDF_PAGES + 1).fill(null))));
  assert.equal(result.errorCode, "page_limit_exceeded");
});

test("PDF text overflow fails instead of returning a truncated successful result", async () => {
  const result = validate(
    await parsePdfDocument(await pdf(Array(110).fill(Array(11).fill("x".repeat(100)).join("\n")))),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "text_limit_exceeded");
  assert.equal("sections" in result, false);
});

test("PDF encrypted documents require a password rather than being classified as scans", async () => {
  const document = await PDFDocument.create();
  document.addPage();
  const encryption = document.context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(1),
    R: PDFNumber.of(2),
    O: PDFHexString.of("00".repeat(32)),
    U: PDFHexString.of("00".repeat(32)),
    P: PDFNumber.of(-4),
  });
  document.context.trailerInfo.Encrypt = document.context.register(encryption);
  document.context.trailerInfo.ID = document.context.obj([
    PDFHexString.of("00".repeat(16)),
    PDFHexString.of("00".repeat(16)),
  ]);
  const result = validate(await parsePdfDocument(await document.save({ useObjectStreams: false })));
  assert.equal(result.errorCode, "password_required");
});
