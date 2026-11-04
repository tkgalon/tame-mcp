import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { parseDocxDocument } from "../src/docx";
import { MAX_DOCX_ENTRIES, MAX_DOCX_ENTRY_BYTES, MAX_DOCX_EXPANDED_BYTES } from "../src/docx-archive";

function docx(body, extra = {}, options = {}) {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`,
      ),
      ...extra,
    },
    options,
  );
}

const paragraph = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const heading = (level, text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const validate = (result) => extractionResultSchema.parse(result);

test("DOCX extracts headings, Unicode, paragraphs and table text without page guesses", async () => {
  const bytes = docx(
    heading(1, "CTF Narasi") +
      paragraph("Temuan 😀") +
      heading(2, "Evidence") +
      "<w:tbl><w:tr><w:tc>" +
      paragraph("Question") +
      "</w:tc><w:tc>" +
      paragraph("Answer") +
      "</w:tc></w:tr></w:tbl>",
  );
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "ready");
  assert.equal(result.contentHash, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    ["CTF Narasi", "Evidence"],
  );
  assert.ok(result.sections.every((section) => section.page === null));
  assert.match(result.sections[0].content, /Temuan 😀/);
  assert.match(result.sections[1].content, /Question[\s\S]*Answer/);
  assert.deepEqual(await parseDocxDocument(bytes), result);
});

test("DOCX preserves numbered question labels and literal code-like content", async () => {
  const result = validate(
    await parseDocxDocument(
      docx(paragraph("1. What is the flag?") + paragraph("  print(&quot;flag&quot;)  ")),
    ),
  );
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /1\. What is the flag\?/);
  assert.match(result.sections[0].content, / {2}print\("flag"\) {2}/);
});

test("DOCX extracts real Word numbering as ordered list markers", async () => {
  const question = (text) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const numbering =
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const result = validate(
    await parseDocxDocument(
      docx(question("First question") + question("Second question"), {
        "word/numbering.xml": strToU8(numbering),
      }),
    ),
  );
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /1\. First question\n2\. Second question/);
});

test("DOCX hyperlinks are plain labels and never fetched or rendered", async () => {
  const body =
    '<w:p><w:hyperlink r:id="link"><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:hyperlink></w:p>';
  const bytes = docx(body, {
    "word/_rels/document.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://127.0.0.1:1/private" TargetMode="External"/></Relationships>',
    ),
  });
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
  const many = Object.fromEntries(
    Array.from({ length: MAX_DOCX_ENTRIES }, (_, index) => [`extra/${index}`, new Uint8Array()]),
  );
  const oversized = { "huge.xml": new Uint8Array(MAX_DOCX_ENTRY_BYTES + 1) };
  const total = Object.fromEntries(
    Array.from({ length: MAX_DOCX_EXPANDED_BYTES / MAX_DOCX_ENTRY_BYTES + 1 }, (_, index) => [
      `large/${index}`,
      new Uint8Array(MAX_DOCX_ENTRY_BYTES),
    ]),
  );
  for (const extra of [many, oversized, total]) {
    const result = validate(await parseDocxDocument(docx(paragraph("small"), extra)));
    assert.equal(result.errorCode, "archive_limit_exceeded");
  }
});

test("DOCX rejects path traversal and repeated entry names", async () => {
  const traversal = docx(paragraph("safe"), { "../escape": strToU8("bad") });
  assert.equal((await parseDocxDocument(traversal)).errorCode, "invalid_document");
  const repeated = Buffer.from(
    docx(paragraph("safe"), { duplicate1: strToU8("one"), duplicate2: strToU8("two") }, { level: 0 }),
  );
  for (
    let offset = repeated.indexOf("duplicate2");
    offset !== -1;
    offset = repeated.indexOf("duplicate2", offset + 1)
  )
    repeated.write("duplicate1", offset);
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
  const body =
    '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="image" descr="Evidence screenshot"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:link="image1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const bytes = docx(paragraph("Finding") + body, {
    "word/_rels/document.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///private/nonexistent-secret.png" TargetMode="External"/></Relationships>',
    ),
  });
  const result = validate(await parseDocxDocument(bytes));
  assert.equal(result.status, "ready");
  assert.ok(result.warnings.includes("images_not_extracted"));
  assert.match(result.sections[0].content, /Finding/);
});

const run = (text, props = "") => `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test("DOCX marks bold text, keeps table rows together and numbers images", async () => {
  const image =
    '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="Screenshot" descr="Inbox header"/></wp:inline></w:drawing></w:r>';
  const result = validate(
    await parseDocxDocument(
      docx(
        `<w:p>${run("Answer: ")}${run("billing@example.test ", "<w:b/>")}${run("", "<w:b/>")}</w:p>` +
          heading(1, "Q1") +
          "<w:tbl><w:tr><w:tc>" +
          paragraph("No") +
          "</w:tc><w:tc>" +
          paragraph("Answer") +
          "</w:tc></w:tr><w:tr><w:tc>" +
          paragraph("1") +
          "</w:tc><w:tc>" +
          paragraph("a|b") +
          paragraph("second line") +
          "</w:tc></w:tr></w:tbl>" +
          `<w:p>${image}</w:p>`,
      ),
    ),
  );
  assert.equal(result.status, "ready");
  const text = result.sections.map((section) => section.content).join("");
  assert.match(text, /Answer: \*\*billing@example\.test\*\* \n/);
  assert.doesNotMatch(text, /\*\*\*\*/);
  assert.match(text, /\| No \| Answer \|\n\| --- \| --- \|\n\| 1 \| a\\\|b second line \|\n/);
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    [null, "Q1"],
  );
});

test("DOCX style summary reads fonts, colors, shading, alignment, header, footer and page size", async () => {
  const styles =
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style>' +
    "</w:styles>";
  const theme =
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>';
  const footer =
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">Halaman </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> of 3</w:t></w:r></w:p></w:ftr>';
  const header =
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Weekly CTF</w:t></w:r></w:p></w:hdr>';
  const body =
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run("Exhibit NET-02")}</w:p>` +
    `<w:p><w:pPr><w:shd w:val="clear" w:fill="E7F1FB"/><w:jc w:val="both"/></w:pPr>${run("Q1. What host sent it?", "<w:b/>")}</w:p>` +
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run("Body text that explains how the answer was found in the capture.")}</w:p>` +
    `<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr>${paragraph("No")}</w:tc></w:tr></w:tbl>` +
    `<w:p>${run("x", '<w:rFonts w:ascii="Courier New"/><w:color w:val="auto"/>')}</w:p>` +
    '<w:p><w:r><w:drawing/></w:r></w:p><w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice><w:r><w:drawing/></w:r></mc:Choice><mc:Fallback><w:r><w:pict/></w:r></mc:Fallback></mc:AlternateContent></w:p>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1800"/></w:sectPr>';
  const result = validate(
    await parseDocxDocument(
      docx(body, {
        "word/styles.xml": strToU8(styles),
        "word/theme/theme1.xml": strToU8(theme),
        "word/header1.xml": strToU8(header),
        "word/footer1.xml": strToU8(footer),
      }),
    ),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.parserVersion, "docx-v2");
  const style = result.style;
  assert.ok(style);
  assert.equal(style.source, "docx");
  assert.deepEqual(style.page, {
    widthPt: 595.3,
    heightPt: 841.9,
    marginsPt: { top: 72, right: 72, bottom: 72, left: 90 },
  });
  const body11 = style.textStyles[0];
  assert.deepEqual(
    { font: body11.font, sizePt: body11.sizePt, bold: body11.bold, alignment: body11.alignment },
    { font: "Calibri", sizePt: 11, bold: false, alignment: "justify" },
  );
  const title = style.textStyles.find((text) => text.sample === "Exhibit NET-02");
  assert.deepEqual(
    { sizePt: title?.sizePt, bold: title?.bold, color: title?.color, alignment: title?.alignment },
    { sizePt: 16, bold: true, color: "#1f3864", alignment: "center" },
  );
  assert.ok(style.textStyles.some((text) => text.font === "Courier New" && text.color === null));
  assert.deepEqual(style.fills, [
    { color: "#e7f1fb", count: 1, sample: "Q1. What host sent it?" },
    { color: "#d9d9d9", count: 1, sample: "No" },
  ]);
  assert.equal(style.tables, 1);
  assert.equal(style.images, 2);
  assert.deepEqual(style.header, ["Weekly CTF"]);
  assert.deepEqual(style.footer, ["Halaman {page}", "Page {page} of 3"]);
});

test("DOCX marks where each image sits in the text", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  );
  const drawing =
    '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="Picture 1" descr="Inbox header"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const relationships =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>';
  const result = validate(
    await parseDocxDocument(
      docx(paragraph("Before") + `<w:p>${drawing}</w:p>` + paragraph("Caption under the screenshot"), {
        "word/_rels/document.xml.rels": strToU8(relationships),
        "word/media/image1.png": png,
      }),
    ),
  );
  assert.equal(result.status, "ready");
  assert.match(result.sections[0].content, /Before\n\[Image 1: Inbox header\]\nCaption under the screenshot/);
  assert.equal(result.style?.images, 1);
});
