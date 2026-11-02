import type { ExtractionResult } from "@tame/contracts";
import { buildExtraction, decodeDocument } from "./core.js";

export const TEXT_PARSER_VERSION = "plain-text-v1";

export function parseTextDocument(bytes: Uint8Array): ExtractionResult {
  const decoded = decodeDocument(bytes, TEXT_PARSER_VERSION);
  if (!decoded.ok) return decoded.result;
  return buildExtraction(decoded.document, [{ start: 0, end: decoded.document.text.length, heading: null }]);
}
