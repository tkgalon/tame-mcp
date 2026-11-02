import { describe, expect, it, vi } from "vitest";
import { uploadDocument } from "../lib/documents/upload";
import type { UploadCheckpoint } from "../lib/documents/upload";

const collectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const document = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", collection_id: collectionId, name: "example.pdf",
  media_type: "application/pdf", size_bytes: 3, status: "uploading", created_at: "2026-11-01T00:00:00Z" };
const ticket = { upload: { signedUrl: "http://127.0.0.1:54321/storage/v1/object/upload/sign/documents/example?token=private", contentType: "application/pdf", method: "PUT" } };
const file = new File(["pdf"], document.name, { type: "application/pdf" });
function options(request: typeof fetch, checkpoint: UploadCheckpoint | null = null) {
  return { collectionId, file, request, checkpoint, onCheckpoint: vi.fn(), onStage: vi.fn(), signal: new AbortController().signal };
}
const completed = () => Response.json({ document: { ...document, status: "uploaded" } });

describe("document upload workflow", () => {
  it("registers, transfers bytes without cookies, and confirms before reporting success", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ document }))
      .mockResolvedValueOnce(Response.json(ticket)).mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(completed());
    const input = options(request);
    expect((await uploadDocument(input)).status).toBe("uploaded");
    expect(request.mock.calls.map(call => call[0])).toEqual([
      `/api/collections/${collectionId}/uploads`, `/api/documents/${document.id}/upload-url`,
      ticket.upload.signedUrl, `/api/documents/${document.id}/complete`,
    ]);
    expect(input.onCheckpoint).toHaveBeenCalledWith({ document });
    expect(request.mock.calls[2]?.[1]).toMatchObject({ method: "PUT", credentials: "omit", body: file, redirect: "error", headers: { "Content-Type": "application/pdf" } });
  });

  it("recovers a lost confirmation response using the same document without another transfer", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ document }))
      .mockResolvedValueOnce(Response.json(ticket)).mockResolvedValueOnce(new Response("{}"))
      .mockRejectedValueOnce(new TypeError("private network information"));
    const first = options(request);
    await expect(uploadDocument(first)).rejects.toMatchObject({ code: "upload_unavailable" });
    const checkpoint = first.onCheckpoint.mock.calls[0]![0];
    request.mockResolvedValueOnce(completed());
    expect((await uploadDocument(options(request, checkpoint))).id).toBe(document.id);
    expect(request.mock.calls.filter(call => call[0] === `/api/collections/${collectionId}/uploads`)).toHaveLength(1);
    expect(request.mock.calls.filter(call => call[1]?.method === "PUT")).toHaveLength(1);
  });

  it("retries a transfer that did not reach storage without registering another document", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: "not_found" } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(ticket)).mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(completed());
    expect((await uploadDocument(options(request, { document: { ...document, status: "uploading" } }))).status).toBe("uploaded");
    expect(request.mock.calls[0]?.[0]).toBe(`/api/documents/${document.id}/complete`);
    expect(request.mock.calls.some(call => String(call[0]).includes("/uploads"))).toBe(false);
  });

  it("stops before transferring invalid or mismatched files", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(uploadDocument({ ...options(request), file: new File(["bad"], "bad.exe") })).rejects.toMatchObject({ code: "invalid_file" });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(Response.json({ document: { ...document, collection_id: document.id } }));
    await expect(uploadDocument(options(request))).rejects.toMatchObject({ code: "invalid_response" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not treat transfer or verification errors as successful uploads", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ document }))
      .mockResolvedValueOnce(Response.json(ticket)).mockResolvedValueOnce(new Response("private provider error", { status: 500 }));
    await expect(uploadDocument(options(request))).rejects.toMatchObject({ code: "transfer_failed" });
    expect(request).toHaveBeenCalledTimes(3);
    const retry = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: "invalid_upload", message: "private details" } }, { status: 409 }));
    await expect(uploadDocument(options(retry, { document: { ...document, status: "uploading" } }))).rejects.toMatchObject({ code: "invalid_upload" });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows a useful session error without exposing backend details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: "unauthenticated", message: "private details" } }, { status: 401 }));
    await expect(uploadDocument(options(request))).rejects.toMatchObject({ message: "Your session has expired. Sign in again before retrying." });
  });
});
