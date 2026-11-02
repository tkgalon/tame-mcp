import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { ExtractionResult, ExtractionWarning } from "@tame/contracts";
import { binaryDocument, ExtractionInputError, TextBudget } from "./binary.js";
import { buildExtraction, extractionFailure } from "./core.js";
import type { ExtractionBlock } from "./core.js";

export const PDF_PARSER_VERSION = "pdf-v1";
export const MAX_PDF_PAGES = 200;
export const MAX_PDF_TEXT_ITEMS = 100_000;

export async function parsePdfDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  const { base, tooLarge } = binaryDocument(bytes, PDF_PARSER_VERSION);
  if (tooLarge) return extractionFailure(base, "file_too_large");
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) {
    return extractionFailure(base, "format_mismatch");
  }
  const warnings = new Set<ExtractionWarning>(["layout_approximate"]);
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({
      data: Uint8Array.from(bytes),
      verbosity: 0,
      stopAtErrors: true,
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      disableAutoFetch: true,
    });
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new ExtractionInputError("page_limit_exceeded");
    const text = new TextBudget();
    const blocks: ExtractionBlock[] = [];
    let itemCount = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const start = text.text.length;
      let previous: TextItem | undefined;
      try {
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (++itemCount > MAX_PDF_TEXT_ITEMS) throw new ExtractionInputError("complexity_limit_exceeded");
          if (!("str" in item) || !item.str) continue;
          if (previous && !previous.hasEOL) {
            const movedLine = Math.abs((item.transform[5] ?? 0) - (previous.transform[5] ?? 0)) > 2;
            if (movedLine) text.append("\n");
            else if (!text.text.endsWith(" ") && !item.str.startsWith(" ")) text.append(" ");
          }
          text.append(item.str);
          if (item.hasEOL) text.append("\n");
          previous = item;
        }
      } finally {
        page.cleanup();
      }
      if (text.text.slice(start).trim()) {
        text.append("\n");
        blocks.push({ start, end: text.text.length, heading: null, page: number });
      } else {
        text.text = text.text.slice(0, start);
        warnings.add("pages_without_text");
      }
    }
    if (!text.text.trim())
      return { ...base, status: "needs_ocr", errorCode: "no_extractable_text", warnings: [...warnings] };
    return buildExtraction({ ...base, text: text.text }, blocks, warnings);
  } catch (error) {
    const code =
      error instanceof ExtractionInputError
        ? error.code
        : error instanceof Error && error.name === "PasswordException"
          ? "password_required"
          : "invalid_document";
    return extractionFailure(base, code, warnings);
  } finally {
    await task?.destroy().catch(() => {});
  }
}
