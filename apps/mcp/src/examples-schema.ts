import { z } from "zod";
import { extractedSectionSchema, extractionWarningSchema, MAX_EXTRACTION_SECTIONS } from "@tame/contracts";

export const EXAMPLE_PAGE_SIZE = 20;
export const SECTION_PAGE_SIZE = 3;
export const idSchema = z.uuid().transform(value => value.toLowerCase());
const versionSchema = z.number().int().min(1).max(2_147_483_647);
export const collectionSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(120), created_at: z.iso.datetime({ offset: true }) });
export const documentSchema = z.object({
  id: z.uuid(), collection_id: z.uuid(), name: z.string().min(1).max(255),
  media_type: z.string().max(255), size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
  status: z.enum(["uploading", "uploaded", "processing", "ready", "needs_ocr", "unsupported", "failed"]),
  created_at: z.iso.datetime({ offset: true }), extraction_version: versionSchema,
  warnings: z.array(extractionWarningSchema).max(10),
});
export const sectionSchema = z.object({
  id: z.uuid(), document_id: z.uuid(), extraction_version: versionSchema,
  ordinal: z.number().int().min(0).max(MAX_EXTRACTION_SECTIONS - 1),
  heading: extractedSectionSchema.shape.heading, page: extractedSectionSchema.shape.page,
  content: extractedSectionSchema.shape.content,
  source_start: extractedSectionSchema.shape.sourceStart.nullable(),
  source_end: extractedSectionSchema.shape.sourceEnd.nullable(),
}).refine(section => (section.source_start === null && section.source_end === null)
  || (section.source_start !== null && section.source_end !== null
    && section.source_end - section.source_start === section.content.length));
export const pageInputSchema = z.strictObject({ page: z.number().int().min(1).max(10_000).default(1) });
export const documentsInputSchema = pageInputSchema.extend({ collectionId: idSchema });
export const readInputSchema = z.strictObject({
  documentId: idSchema, version: versionSchema.optional(),
  after: z.number().int().min(0).max(MAX_EXTRACTION_SECTIONS - 1).optional(),
}).refine(input => input.after === undefined || input.version !== undefined, {
  message: "Continuation requires the extraction version returned by the previous read.",
});
export const collectionsOutputSchema = z.object({ items: z.array(collectionSchema).max(EXAMPLE_PAGE_SIZE), nextPage: z.number().int().positive().nullable() });
export const documentsOutputSchema = z.object({ items: z.array(documentSchema).max(EXAMPLE_PAGE_SIZE), nextPage: z.number().int().positive().nullable() });
export const readOutputSchema = z.object({
  document: documentSchema, sections: z.array(sectionSchema).max(SECTION_PAGE_SIZE),
  extractionVersion: versionSchema, nextAfter: z.number().int().nonnegative().nullable(),
});
