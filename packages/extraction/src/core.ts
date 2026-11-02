import { createHash } from "node:crypto";
import {
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  MAX_EXTRACTION_SECTIONS,
  MAX_HEADING_CHARACTERS,
  MAX_SECTION_CHARACTERS,
} from "@tame/contracts";
import type {
  ExtractedSection,
  ExtractionErrorCode,
  ExtractionFailure,
  ExtractionResult,
  ExtractionWarning,
} from "@tame/contracts";

export type DecodedDocument = { text: string; contentHash: string; parserVersion: string };
export type ExtractionBlock = { start: number; end: number; heading: string | null; page?: number };

export function extractionFailure(
  base: Pick<DecodedDocument, "contentHash" | "parserVersion">,
  errorCode: ExtractionErrorCode,
  warnings: Iterable<ExtractionWarning> = [],
): ExtractionFailure {
  return {
    status: "failed",
    contentHash: base.contentHash,
    parserVersion: base.parserVersion,
    errorCode,
    warnings: [...new Set(warnings)],
  };
}

export function decodeDocument(
  bytes: Uint8Array,
  parserVersion: string,
): { ok: true; document: DecodedDocument } | { ok: false; result: ExtractionFailure } {
  const base = { contentHash: createHash("sha256").update(bytes).digest("hex"), parserVersion };
  const failed = (error: ExtractionErrorCode) => ({
    ok: false as const,
    result: extractionFailure(base, error),
  });
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return failed("file_too_large");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch {
    return failed("invalid_utf8");
  }
  if (!text.trim()) return failed("empty_document");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return failed("binary_content");
  if (text.startsWith("%PDF-")) return failed("format_mismatch");
  let characters = 0;
  for (const _character of text)
    if (++characters > MAX_EXTRACTED_CHARACTERS) return failed("text_limit_exceeded");
  return { ok: true, document: { ...base, text } };
}

export function limitHeading(heading: string | null, warnings: Set<ExtractionWarning>): string | null {
  if (heading === null || !heading.length) return null;
  let offset = 0;
  let characters = 0;
  for (const character of heading) {
    if (++characters > MAX_HEADING_CHARACTERS) {
      warnings.add("heading_shortened");
      return heading.slice(0, offset);
    }
    offset += character.length;
  }
  return heading;
}

export function buildExtraction(
  document: DecodedDocument,
  blocks: ExtractionBlock[],
  initialWarnings: Iterable<ExtractionWarning> = [],
): ExtractionResult {
  const warnings = new Set(initialWarnings);
  const sections: ExtractedSection[] = [];
  let nextBlockStart = 0;
  for (const block of blocks) {
    if (block.start !== nextBlockStart || block.end < block.start || block.end > document.text.length) {
      return extractionFailure(document, "parser_error", warnings);
    }
    nextBlockStart = block.end;
    const heading = limitHeading(block.heading, warnings);
    let start = block.start;
    while (start < block.end) {
      let end = start;
      let count = 0;
      let lineBreak = start;
      let paragraphBreak = start;
      let lineCount = 0;
      let paragraphCount = 0;
      let previousNewline = false;
      while (end < block.end && count < MAX_SECTION_CHARACTERS) {
        const point = document.text.codePointAt(end);
        if (point === undefined) return extractionFailure(document, "parser_error", warnings);
        end += point > 0xffff ? 2 : 1;
        count++;
        if (point === 10) {
          lineBreak = end;
          lineCount = count;
          if (previousNewline) {
            paragraphBreak = end;
            paragraphCount = count;
          }
        }
        previousNewline = point === 10;
      }
      if (end < block.end) {
        warnings.add("section_split");
        if (paragraphCount >= MAX_SECTION_CHARACTERS / 2) end = paragraphBreak;
        else if (lineCount >= MAX_SECTION_CHARACTERS / 2) end = lineBreak;
      }
      sections.push({
        ordinal: sections.length,
        heading,
        page: block.page ?? null,
        content: document.text.slice(start, end),
        sourceStart: start,
        sourceEnd: end,
      });
      if (sections.length > MAX_EXTRACTION_SECTIONS)
        return extractionFailure(document, "section_limit_exceeded", warnings);
      start = end;
    }
  }
  if (nextBlockStart !== document.text.length || sections.length === 0)
    return extractionFailure(document, "parser_error", warnings);
  return {
    status: "ready",
    contentHash: document.contentHash,
    parserVersion: document.parserVersion,
    warnings: [...warnings],
    sections,
  };
}
