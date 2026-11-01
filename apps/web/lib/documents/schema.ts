import { z } from "zod";
import { extractedSectionSchema, extractionErrorCodeSchema, extractionWarningSchema, MAX_EXTRACTION_SECTIONS } from "@tame/contracts";

export const DOCUMENT_PAGE_SIZE = 20;
export const MAX_DOCUMENT_PAGE = 10_000;

export const documentSchema = z.object({
  id: z.uuid(),
  collection_id: z.uuid(),
  name: z.string(),
  media_type: z.string(),
  size_bytes: z.number().int().positive(),
  status: z.enum(["uploading", "uploaded", "processing", "ready", "needs_ocr", "unsupported", "failed"]),
  created_at: z.iso.datetime({ offset: true }),
});

export const storedDocumentSchema = documentSchema.extend({ owner_id: z.uuid(), storage_path: z.string().min(1) });
export const documentPageSchema = z.coerce.number().int().min(1).max(MAX_DOCUMENT_PAGE);
export const resourceIdSchema = z.uuid();

export type Document = z.infer<typeof documentSchema>;

export const SECTION_PAGE_SIZE = 10;
const extractionVersionSchema = z.number().int().min(1).max(2_147_483_647);
const documentErrorCodeSchema = z.enum([
  ...extractionErrorCodeSchema.options, "no_extractable_text", "unsupported_media_type",
  "storage_unavailable", "parser_timeout", "parser_crashed", "worker_error", "lease_expired",
]);

export const documentDetailSchema = documentSchema.extend({
  extraction_version: extractionVersionSchema,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  parser_version: z.string().min(1).max(100).nullable(),
  warnings: z.array(extractionWarningSchema).max(10),
  extraction_error_code: documentErrorCodeSchema.nullable(),
});

export const documentSectionSchema = z.object({
  id: z.uuid(), document_id: z.uuid(), extraction_version: extractionVersionSchema,
  ordinal: extractedSectionSchema.shape.ordinal.max(MAX_EXTRACTION_SECTIONS - 1),
  heading: extractedSectionSchema.shape.heading, page: extractedSectionSchema.shape.page,
  content: extractedSectionSchema.shape.content,
  source_start: extractedSectionSchema.shape.sourceStart.nullable(),
  source_end: extractedSectionSchema.shape.sourceEnd.nullable(),
}).refine(section => (section.source_start === null && section.source_end === null)
  || (section.source_start !== null && section.source_end !== null
    && section.source_end - section.source_start === section.content.length), {
  message: "Section offsets must both be absent or match the UTF-16 content length.",
});

const integerParam = z.union([z.number(), z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number)]);
export const sectionQuerySchema = z.object({
  version: integerParam.pipe(extractionVersionSchema).optional(),
  after: integerParam.pipe(z.number().int().min(0).max(MAX_EXTRACTION_SECTIONS - 1)).optional(),
}).refine(query => query.after === undefined || query.version !== undefined, {
  message: "Continuation requests require an extraction version.",
});
export type SectionQuery = z.infer<typeof sectionQuerySchema>;
