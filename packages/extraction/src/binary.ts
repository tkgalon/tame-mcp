import { createHash } from "node:crypto";
import { MAX_DOCUMENT_BYTES, MAX_EXTRACTED_CHARACTERS } from "@tame/contracts";
import type { ExtractionErrorCode } from "@tame/contracts";

export class ExtractionInputError extends Error {
  constructor(readonly code: ExtractionErrorCode) {
    super(code);
  }
}

export function binaryDocument(bytes: Uint8Array, parserVersion: string) {
  const base = { contentHash: createHash("sha256").update(bytes).digest("hex"), parserVersion };
  return { base, tooLarge: bytes.byteLength > MAX_DOCUMENT_BYTES };
}

export class TextBudget {
  text = "";
  private characters = 0;

  append(value: string): void {
    const normalized = value.replace(/\r\n?/g, "\n");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
      throw new ExtractionInputError("invalid_text_content");
    }
    for (const _character of normalized) {
      if (++this.characters > MAX_EXTRACTED_CHARACTERS) throw new ExtractionInputError("text_limit_exceeded");
    }
    this.text += normalized;
  }

  // Drops text appended after length, such as an empty bold marker
  truncate(length: number): void {
    const removed = this.text.slice(length);
    this.characters -= [...removed].length;
    this.text = this.text.slice(0, length);
  }
}
