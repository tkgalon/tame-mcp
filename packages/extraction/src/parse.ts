import { createHash } from "node:crypto";
import { currentParserVersion } from "@tame/contracts";
import type { ExtractionResult } from "@tame/contracts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function parserVersion(mediaType: string): string {
  return currentParserVersion(mediaType);
}

export async function parseDocument(bytes: Uint8Array, mediaType: string): Promise<ExtractionResult> {
  switch (mediaType) {
    case "text/plain":
      return (await import("./text.js")).parseTextDocument(bytes);
    case "text/markdown":
      return (await import("./markdown.js")).parseMarkdownDocument(bytes);
    case "application/pdf":
      return (await import("./pdf.js")).parsePdfDocument(bytes);
    case DOCX:
      return (await import("./docx.js")).parseDocxDocument(bytes);
    default:
      return {
        status: "unsupported",
        errorCode: "unsupported_media_type",
        warnings: [],
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        parserVersion: parserVersion(mediaType),
      };
  }
}
