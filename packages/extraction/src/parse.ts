import { createHash } from "node:crypto";
import type { ExtractionResult } from "@tame/contracts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function parserVersion(mediaType: string): string {
  switch (mediaType) {
    case "text/plain":
      return "plain-text-v1";
    case "text/markdown":
      return "markdown-v1";
    case "application/pdf":
      return "pdf-v1";
    case DOCX:
      return "docx-v1";
    default:
      return "unsupported-v1";
  }
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
