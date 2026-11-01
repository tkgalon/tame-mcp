import { z } from "zod";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 100_000;
export const MAX_SECTION_CHARACTERS = 8_000;
export const MAX_HEADING_CHARACTERS = 500;
export const MAX_EXTRACTION_SECTIONS = 1_000;

function withinCodePointLimit(value: string, limit: number): boolean {
  let count = 0;
  for (const _character of value) if (++count > limit) return false;
  return true;
}

export const extractionWarningSchema = z.enum(["section_split", "heading_shortened", "images_not_extracted", "html_preserved"]);
export type ExtractionWarning = z.infer<typeof extractionWarningSchema>;

export const extractionErrorCodeSchema = z.enum([
  "empty_document", "file_too_large", "invalid_utf8", "binary_content", "format_mismatch",
  "text_limit_exceeded", "section_limit_exceeded", "parser_error",
]);
export type ExtractionErrorCode = z.infer<typeof extractionErrorCodeSchema>;

export const extractedSectionSchema = z.strictObject({
  ordinal: z.number().int().min(0),
  heading: z.string().max(MAX_HEADING_CHARACTERS * 2)
    .refine(value => !value.includes("\0") && withinCodePointLimit(value, MAX_HEADING_CHARACTERS)).nullable(),
  page: z.number().int().positive().nullable(),
  content: z.string().min(1).max(MAX_SECTION_CHARACTERS * 2)
    .refine(value => !value.includes("\0") && withinCodePointLimit(value, MAX_SECTION_CHARACTERS)),
  sourceStart: z.number().int().min(0).max(MAX_EXTRACTED_CHARACTERS * 2),
  sourceEnd: z.number().int().positive().max(MAX_EXTRACTED_CHARACTERS * 2),
}).refine(section => section.sourceEnd - section.sourceStart === section.content.length, {
  message: "Source offsets must match the section's UTF-16 length.",
});
export type ExtractedSection = z.infer<typeof extractedSectionSchema>;

const extractionBase = {
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().min(1).max(100),
  warnings: z.array(extractionWarningSchema).max(10),
};

export const readyExtractionSchema = z.strictObject({
  ...extractionBase,
  status: z.literal("ready"),
  sections: z.array(extractedSectionSchema).min(1).max(MAX_EXTRACTION_SECTIONS),
}).superRefine((result, context) => {
  let nextOffset = 0;
  let totalCharacters = 0;
  for (const [index, section] of result.sections.entries()) {
    if (section.ordinal !== index || section.sourceStart !== nextOffset) {
      context.addIssue({ code: "custom", path: ["sections", index], message: "Sections must have contiguous source offsets and ordinals." });
    }
    nextOffset = section.sourceEnd;
    for (const _character of section.content) {
      if (++totalCharacters > MAX_EXTRACTED_CHARACTERS) {
        context.addIssue({ code: "custom", path: ["sections"], message: "Extracted text exceeds the document limit." });
        return;
      }
    }
  }
});

export const failedExtractionSchema = z.strictObject({
  ...extractionBase, status: z.literal("failed"), errorCode: extractionErrorCodeSchema,
});

export const unsupportedExtractionSchema = z.strictObject({
  ...extractionBase, status: z.literal("unsupported"), errorCode: z.literal("unsupported_media_type"),
});

export const extractionResultSchema = z.discriminatedUnion("status", [
  readyExtractionSchema, failedExtractionSchema, unsupportedExtractionSchema,
]);
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractionFailure = z.infer<typeof failedExtractionSchema>;
