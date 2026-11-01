import { z } from "zod";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

const mediaTypes: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

export const uploadMetadataSchema = z.object({
  collectionId: z.uuid(),
  name: z.string().trim().min(1).max(255)
    .refine(value => !/[\u0000-\u001f\u007f/\\]/.test(value)),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
}).transform((input, context) => {
  const extension = input.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const mediaType = extension && Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
  if (!mediaType) {
    context.addIssue({ code: "custom", path: ["name"], message: "Use a PDF, DOCX, TXT, or Markdown document." });
    return z.NEVER;
  }
  return { ...input, mediaType };
});

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
