import { expect, test } from "vitest";
import { currentParserVersion, documentStyleSchema, readyExtractionSchema } from "../src/index";
import type { DocumentStyle } from "../src/index";

const style: DocumentStyle = {
  source: "pdf",
  page: { widthPt: 595, heightPt: 842, marginsPt: { top: 72, right: 72, bottom: 72, left: 72 } },
  textStyles: [
    {
      font: "Arial",
      sizePt: 11,
      bold: false,
      italic: false,
      color: "#000000",
      alignment: "justify",
      share: 0.9,
      sample: "Body text",
    },
  ],
  fills: [{ color: "#e7f1fb", count: 3, sample: "Q1. Which host?" }],
  tables: null,
  images: 4,
  rules: 2,
  header: [],
  footer: ["Halaman {n}"],
  pagesMeasured: 3,
};

test("style summaries are optional on ready extractions and validated when present", () => {
  const ready = {
    status: "ready",
    contentHash: "a".repeat(64),
    parserVersion: "pdf-v2",
    warnings: [],
    sections: [{ ordinal: 0, heading: null, page: 1, content: "Text", sourceStart: 0, sourceEnd: 4 }],
  };
  expect(readyExtractionSchema.safeParse(ready).success).toBe(true);
  expect(readyExtractionSchema.safeParse({ ...ready, style }).success).toBe(true);
  const badColor = { ...style, fills: [{ color: "blue", count: 1, sample: null }] };
  expect(documentStyleSchema.safeParse(badColor).success).toBe(false);
  const tooMany = { ...style, textStyles: Array.from({ length: 13 }, () => style.textStyles[0]) };
  expect(documentStyleSchema.safeParse(tooMany).success).toBe(false);
});

test("parser versions are known per media type", () => {
  expect(currentParserVersion("application/pdf")).toBe("pdf-v2");
  expect(currentParserVersion("image/png")).toBe("unsupported-v1");
});
