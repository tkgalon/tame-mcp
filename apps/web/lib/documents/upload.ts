import { z } from "zod";
import { documentSchema } from "./schema";
import type { Document } from "./schema";
import { uploadMetadataSchema } from "./upload-schema";

export class UploadError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const messages: Record<string, string> = {
  unauthenticated: "Your session has expired. Sign in again before retrying.",
  not_found: "The collection or document is no longer available.",
  invalid_upload: "The uploaded file could not be verified. Select the file again to start a new upload.",
  forbidden: "This session cannot upload documents.",
  invalid_origin: "Open the app at its configured address and try again.",
};
const ticketSchema = z.object({ upload: z.object({
  signedUrl: z.url(), contentType: z.string(), method: z.literal("PUT"),
}) });
export type UploadCheckpoint = { document: Document };

export async function uploadDocument(options: {
  collectionId: string; file: File; checkpoint: UploadCheckpoint | null;
  onCheckpoint: (value: UploadCheckpoint) => void; onStage: (value: string) => void;
  signal: AbortSignal; request?: typeof fetch;
}) {
  const { collectionId, file, onCheckpoint, onStage, signal } = options;
  const request = options.request ?? fetch;
  const metadata = uploadMetadataSchema.safeParse({ collectionId, name: file.name, sizeBytes: file.size });
  if (!metadata.success) throw new UploadError("invalid_file", "Choose a PDF, DOCX, TXT, or Markdown file between 1 byte and 10 MiB.");

  async function post(path: string, body?: unknown): Promise<unknown> {
    const response = await request(path, {
      method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(value);
      const code = parsed.success ? parsed.data.error.code : "upload_unavailable";
      throw new UploadError(code, messages[code] ?? "Upload could not be completed. Retry with the same file.");
    }
    return value;
  }
  function readDocument(value: unknown): Document {
    const parsed = z.object({ document: documentSchema }).safeParse(value);
    if (!parsed.success || parsed.data.document.collection_id !== collectionId
      || parsed.data.document.name !== metadata.data!.name || parsed.data.document.size_bytes !== file.size
      || parsed.data.document.media_type !== metadata.data!.mediaType) {
      throw new UploadError("invalid_response", "The upload returned an unexpected response. Select the file again.");
    }
    return parsed.data.document;
  }
  try {
    let document = options.checkpoint?.document;
    if (document) {
      readDocument({ document });
      onStage("Checking the previous upload…");
      try {
        const completed = readDocument(await post(`/api/documents/${document.id}/complete`));
        if (completed.id !== document.id || completed.status === "uploading") throw new UploadError("invalid_response", "The upload could not be verified.");
        return completed;
      } catch (error) {
        if (!(error instanceof UploadError) || error.code !== "not_found") throw error;
      }
    } else {
      onStage("Preparing upload…");
      document = readDocument(await post(`/api/collections/${collectionId}/uploads`, { name: metadata.data.name, sizeBytes: file.size }));
      if (document.status !== "uploading") throw new UploadError("invalid_response", "The document is not waiting for an upload.");
      onCheckpoint({ document });
    }
    const ticket = ticketSchema.parse(await post(`/api/documents/${document.id}/upload-url`));
    if (ticket.upload.contentType !== metadata.data.mediaType) throw new UploadError("invalid_response", "The upload type does not match the file.");
    onStage("Uploading file…");
    const transfer = await request(ticket.upload.signedUrl, {
      method: "PUT", credentials: "omit", redirect: "error", headers: { "Content-Type": ticket.upload.contentType },
      body: file, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    await transfer.body?.cancel();
    if (!transfer.ok) throw new UploadError("transfer_failed", "File transfer failed. Retry with the same file.");
    onStage("Confirming upload…");
    const completed = readDocument(await post(`/api/documents/${document.id}/complete`));
    if (completed.id !== document.id || completed.status === "uploading") throw new UploadError("invalid_response", "The upload could not be verified. Retry with the same file.");
    return completed;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof UploadError) throw error;
    throw new UploadError("upload_unavailable", "The upload was interrupted. Retry with the same file.");
  }
}
