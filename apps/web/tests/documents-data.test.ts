import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), rpc: vi.fn(), single: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(),
  maybeSingle: vi.fn(), order: vi.fn(), range: vi.fn(), bucket: vi.fn(), sign: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));

import { completeUpload, createUploadUrl, listDocuments, registerUpload } from "../lib/documents/data";
import { uploadMetadataSchema } from "../lib/documents/upload-schema";

const owner = "11111111-1111-4111-8111-111111111111";
const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path = `${owner}/${id}/original`;
const row = { id, owner_id: owner, collection_id: collection, name: "example.md", media_type: "text/markdown", size_bytes: 100, status: "uploading", created_at: "2026-11-01T08:00:00Z", storage_path: path };
const metadata = uploadMetadataSchema.parse({ collectionId: collection, name: "example.md", sizeBytes: 100 });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle, order: mocks.order, range: mocks.range };
  for (const mock of [mocks.from, mocks.select, mocks.eq, mocks.order]) mock.mockReturnValue(query);
  mocks.rpc.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: row, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
  mocks.range.mockResolvedValue({ data: [row], error: null });
  mocks.bucket.mockReturnValue({ createSignedUploadUrl: mocks.sign });
  mocks.sign.mockResolvedValue({ data: { path, token: "test-token", signedUrl: "https://example.supabase.co/upload?token=test-token" }, error: null });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.bucket } });
});

describe("upload registration", () => {
  it("uses the controlled RPC without a caller-supplied owner or path", async () => {
    const document = await registerUpload(owner, metadata);
    expect(mocks.rpc).toHaveBeenCalledWith("register_document_upload", { p_collection_id: collection, p_name: "example.md", p_size_bytes: 100 });
    expect(document.id).toBe(id);
    expect(document).not.toHaveProperty("owner_id");
    expect(document).not.toHaveProperty("storage_path");
  });

  it("rejects cross-owner or mismatched provider records", async () => {
    mocks.single.mockResolvedValue({ data: { ...row, owner_id: "22222222-2222-4222-8222-222222222222" }, error: null });
    await expect(registerUpload(owner, metadata)).rejects.toMatchObject({ status: 502 });
    mocks.single.mockResolvedValue({ data: { ...row, size_bytes: 1 }, error: null });
    await expect(registerUpload(owner, metadata)).rejects.toMatchObject({ status: 502 });
  });

  it("maps inaccessible collections to not found without exposing provider details", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "P0002", message: "private details" } });
    await expect(registerUpload(owner, metadata)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("signed upload access", () => {
  it("signs only the owned registered path and disables replacement", async () => {
    const upload = await createUploadUrl(owner, id);
    expect(mocks.eq.mock.calls).toEqual([["id", id], ["owner_id", owner]]);
    expect(mocks.sign).toHaveBeenCalledWith(path, { upsert: false });
    expect(upload.contentType).toBe("text/markdown");
    expect(upload.method).toBe("PUT");
  });

  it("does not sign missing or completed documents", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(createUploadUrl(owner, id)).rejects.toMatchObject({ status: 404 });
    mocks.maybeSingle.mockResolvedValue({ data: { ...row, status: "uploaded" }, error: null });
    await expect(createUploadUrl(owner, id)).rejects.toMatchObject({ status: 409 });
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("rejects a signing response for a different path", async () => {
    mocks.sign.mockResolvedValue({ data: { path: "other", token: "test", signedUrl: "https://example.supabase.co/upload" }, error: null });
    await expect(createUploadUrl(owner, id)).rejects.toMatchObject({ status: 502 });
  });

  it("supports retry after a signing failure using the existing document", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: { message: "private details" } });
    await expect(createUploadUrl(owner, id)).rejects.toMatchObject({ code: "signing_failed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("upload confirmation", () => {
  it("delegates verification to the completion RPC", async () => {
    mocks.single.mockResolvedValue({ data: { ...row, status: "uploaded" }, error: null });
    expect((await completeUpload(owner, id)).status).toBe("uploaded");
    expect(mocks.rpc).toHaveBeenCalledWith("complete_document_upload", { p_document_id: id });
  });

  it("does not report success for a missing object or metadata mismatch", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "22023" } });
    await expect(completeUpload(owner, id)).rejects.toMatchObject({ status: 409 });
    mocks.single.mockResolvedValue({ data: null, error: { code: "P0002" } });
    await expect(completeUpload(owner, id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("document list", () => {
  it("filters by owner and collection and paginates in a stable order", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: collection }, error: null });
    mocks.range.mockResolvedValue({ data: Array.from({ length: 21 }, () => row), error: null });
    const result = await listDocuments(owner, collection, 2);
    expect(result.items).toHaveLength(20);
    expect(result.hasNextPage).toBe(true);
    expect(mocks.range).toHaveBeenCalledWith(20, 40);
    expect(mocks.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(mocks.eq).toHaveBeenCalledWith("collection_id", collection);
    expect(result.items[0]).not.toHaveProperty("storage_path");
  });

  it("distinguishes a missing collection from an empty list", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(listDocuments(owner, collection)).rejects.toMatchObject({ status: 404 });
    mocks.maybeSingle.mockResolvedValue({ data: { id: collection }, error: null });
    mocks.range.mockResolvedValue({ data: [], error: null });
    expect((await listDocuments(owner, collection)).items).toEqual([]);
  });
});
