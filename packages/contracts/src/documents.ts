import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "./extraction.js";

export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

// Bump a version when its parser starts producing different text or style, so older reads can be redone
export const PARSER_VERSIONS: Readonly<Record<string, string>> = {
  "text/plain": "plain-text-v1",
  "text/markdown": "markdown-v1",
  "application/pdf": "pdf-v2",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx-v2",
};

export function currentParserVersion(mediaType: string): string {
  return Object.hasOwn(PARSER_VERSIONS, mediaType) ? PARSER_VERSIONS[mediaType]! : "unsupported-v1";
}

export function mediaTypeForName(name: string): string | null {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return extension && Object.hasOwn(MEDIA_TYPES, extension) ? (MEDIA_TYPES[extension] ?? null) : null;
}

export const documentStatusSchema = z.enum(["uploading", "ready", "needs_ocr", "unsupported", "failed"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const uploadRequestSchema = z.strictObject({
  collectionId: z.uuid().toLowerCase(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) => !/[\u0000-\u001f\u007f/\\]/.test(value),
      "File names cannot contain slashes or control characters.",
    )
    .refine((value) => mediaTypeForName(value) !== null, "Use a PDF, DOCX, TXT or Markdown file."),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const collectionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Names cannot contain control characters.");
