import { createHash } from "node:crypto";
import type { ExtractionResult } from "@tame/contracts";

export function parserVersion(mediaType: string): string {
  switch (mediaType) {
    case "text/plain": return "plain-text-v1";
    case "text/markdown": return "markdown-v1";
    case "application/pdf": return "pdf-v1";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx-v1";
    default: return "unsupported-v1";
  }
}

export async function parseDocument(bytes: Uint8Array, mediaType: string): Promise<ExtractionResult> {
  switch (mediaType) {
    case "text/plain": return (await import("@tame/parsers/text")).parseTextDocument(bytes);
    case "text/markdown": return (await import("@tame/parsers/markdown")).parseMarkdownDocument(bytes);
    case "application/pdf": return (await import("@tame/parsers/pdf")).parsePdfDocument(bytes);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return (await import("@tame/parsers/docx")).parseDocxDocument(bytes);
    default: return {
      status: "unsupported", errorCode: "unsupported_media_type", warnings: [],
      contentHash: createHash("sha256").update(bytes).digest("hex"), parserVersion: parserVersion(mediaType),
    };
  }
}
