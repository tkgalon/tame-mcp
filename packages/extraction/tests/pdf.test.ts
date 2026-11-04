import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { PDFDocument, StandardFonts, PDFName, PDFNumber, PDFHexString, rgb } from "pdf-lib";
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

test("PDF style summary measures fonts, colors, boxes, lines, images and repeated header and footer", async () => {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const image = await document.embedPng(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  for (const number of [1, 2]) {
    const page = document.addPage([595, 842]);
    page.drawText("Weekly CTF Rani Pratama", { x: 60, y: 810, size: 9, font: regular });
    const title = "Exhibit NET-02";
    page.drawText(title, { x: (595 - bold.widthOfTextAtSize(title, 16)) / 2, y: 740, size: 16, font: bold });
    page.drawRectangle({ x: 60, y: 700, width: 475, height: 30, color: rgb(0.906, 0.945, 0.984) });
    page.drawText("Q1. Which host sent the file?", {
      x: 70,
      y: 710,
      size: 11,
      font: bold,
      color: rgb(0.122, 0.22, 0.392),
    });
    for (const [index, line] of [
      "Body text explains the step in a plain voice.",
      "More body text.",
    ].entries()) {
      page.drawText(line, { x: 60, y: 660 - index * 16, size: 11, font: regular });
    }
    page.drawLine({ start: { x: 60, y: 600 }, end: { x: 535, y: 600 }, thickness: 1 });
    page.drawImage(image, { x: 60, y: 350, width: 300, height: 200 });
    page.drawText(`Halaman ${number}`, { x: 500, y: 30, size: 9, font: regular });
  }
  const result = validate(await parsePdfDocument(await document.save()));
  assert.equal(result.status, "ready");
  assert.equal(result.parserVersion, "pdf-v2");
  const style = result.style;
  assert.ok(style);
  assert.deepEqual(style.page && { widthPt: style.page.widthPt, heightPt: style.page.heightPt }, {
    widthPt: 595,
    heightPt: 842,
  });
  const title = style.textStyles.find((text) => text.sample === "Exhibit NET-02");
  assert.deepEqual(
    { font: title?.font, sizePt: title?.sizePt, bold: title?.bold, alignment: title?.alignment },
    { font: "Helvetica", sizePt: 16, bold: true, alignment: "center" },
  );
  const question = style.textStyles.find((text) => text.sample === "Q1. Which host sent the file?");
  assert.equal(question?.color, "#1f3864");
  assert.deepEqual(style.fills, [{ color: "#e7f1fb", count: 2, sample: "Q1. Which host sent the file?" }]);
  assert.equal(style.tables, null);
  assert.equal(style.images, 2);
  assert.equal(style.rules, 2);
  assert.deepEqual(style.header, ["Weekly CTF Rani Pratama"]);
  assert.deepEqual(style.footer, ["Halaman {n}"]);
  assert.equal(style.pagesMeasured, 2);
  assert.ok(style.page?.marginsPt && style.page.marginsPt.left === 60);
});
