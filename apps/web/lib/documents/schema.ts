import { z } from "zod";

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
