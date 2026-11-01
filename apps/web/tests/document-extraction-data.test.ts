import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(), result: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { getDocument, listDocumentSections } from "../lib/documents/read";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const document = { id, owner_id: owner, collection_id: other, name: "example.md", media_type: "text/markdown", size_bytes: 10, status: "ready", created_at: "2026-11-01T08:00:00Z", extraction_version: 1, content_hash: "a".repeat(64), parser_version: "markdown-v1", warnings: [], extraction_error_code: null };
const section = (ordinal = 0) => ({ id: other, owner_id: owner, document_id: id, extraction_version: 1, ordinal, heading: null, page: null, content: "hello", source_start: ordinal * 5, source_end: ordinal * 5 + 5 });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle, order: mocks.order, limit: mocks.limit, gt: mocks.gt, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => mocks.result().then(resolve, reject) };
  for (const mock of [mocks.from, mocks.select, mocks.eq, mocks.order, mocks.limit, mocks.gt]) mock.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({ data: document, error: null });
  mocks.result.mockResolvedValue({ data: [section()], error: null });
  mocks.client.mockResolvedValue({ from: mocks.from });
});

describe("document detail", () => {
  it("filters by verified owner and returns extraction metadata without private fields", async () => {
    const result = await getDocument(owner, id);
    expect(mocks.eq.mock.calls).toEqual([["id", id], ["owner_id", owner]]);
    expect(result.extraction_version).toBe(1);
    expect(result).not.toHaveProperty("owner_id");
    expect(result).not.toHaveProperty("storage_path");
    expect(mocks.client).toHaveBeenCalledWith({ readOnly: true });
  });
  it("normalizes UUID case before comparing provider identity", async () => {
    const canonical = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mocks.maybeSingle.mockResolvedValue({ data: { ...document, id: canonical }, error: null });
    expect((await getDocument(owner, canonical.toUpperCase())).id).toBe(canonical);
    expect(mocks.eq).toHaveBeenCalledWith("id", canonical);
  });
  it("returns the same not-found result for unavailable documents", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getDocument(owner, id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects cross-owner, mismatched, and malformed provider records", async () => {
    for (const row of [{ ...document, owner_id: other }, { ...document, id: other }, { ...document, warnings: ["raw private error"] }]) {
      mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
      await expect(getDocument(owner, id)).rejects.toMatchObject({ status: 502, code: "invalid_provider_response" });
    }
  });
  it("does not expose provider error details", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(getDocument(owner, id)).rejects.toMatchObject({ status: 502, message: "Unable to load the document." });
  });
});

describe("document sections", () => {
  it("bounds the first page and filters by owner, document, and extraction version", async () => {
    mocks.result.mockResolvedValue({ data: Array.from({ length: 11 }, (_, ordinal) => section(ordinal)), error: null });
    const result = await listDocumentSections(owner, id);
    expect(result.items).toHaveLength(10);
    expect(result.extractionVersion).toBe(1);
    expect(result.nextAfter).toBe(9);
    expect(mocks.limit).toHaveBeenCalledWith(11);
    expect(mocks.eq).toHaveBeenCalledWith("document_id", id);
    expect(mocks.eq).toHaveBeenCalledWith("extraction_version", 1);
    expect(mocks.order).toHaveBeenCalledWith("ordinal", { ascending: true });
    expect(result.items[0]).not.toHaveProperty("owner_id");
  });
  it("continues after the last ordinal and returns null on the final page", async () => {
    mocks.result.mockResolvedValue({ data: [section(1)], error: null });
    const result = await listDocumentSections(owner, id, { version: 1, after: 0 });
    expect(mocks.gt).toHaveBeenCalledWith("ordinal", 0);
    expect(result.items[0]?.ordinal).toBe(1);
    expect(result.nextAfter).toBeNull();
    mocks.result.mockResolvedValue({ data: [], error: null });
    expect((await listDocumentSections(owner, id, { version: 1, after: 9 })).items).toEqual([]);
  });
  it("rejects an obsolete version before reading sections", async () => {
    await expect(listDocumentSections(owner, id, { version: 2 })).rejects.toMatchObject({ status: 409, code: "extraction_changed" });
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("keeps pending, OCR and failed documents readable but their sections unavailable", async () => {
    for (const status of ["uploading", "uploaded", "processing", "needs_ocr", "failed", "unsupported"]) {
      mocks.maybeSingle.mockResolvedValue({ data: { ...document, status }, error: null });
      expect((await getDocument(owner, id)).status).toBe(status);
      await expect(listDocumentSections(owner, id)).rejects.toMatchObject({ status: 409, code: "extraction_not_ready" });
    }
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("rejects foreign, wrong-version, duplicate and unordered sections", async () => {
    for (const rows of [[{ ...section(), owner_id: other }], [{ ...section(), document_id: other }], [{ ...section(), extraction_version: 2 }], [section(), section()], [section(1), section()]]) {
      mocks.result.mockResolvedValue({ data: rows, error: null });
      await expect(listDocumentSections(owner, id)).rejects.toMatchObject({ status: 502 });
    }
    mocks.result.mockResolvedValue({ data: [section()], error: null });
    await expect(listDocumentSections(owner, id, { version: 1, after: 0 })).rejects.toMatchObject({ status: 502 });
  });
  it("rejects malformed or oversized responses and hides provider errors", async () => {
    mocks.result.mockResolvedValue({ data: Array.from({ length: 12 }, (_, ordinal) => section(ordinal)), error: null });
    await expect(listDocumentSections(owner, id)).rejects.toMatchObject({ status: 502 });
    mocks.result.mockResolvedValue({ data: [{ ...section(), source_end: 4 }], error: null });
    await expect(listDocumentSections(owner, id)).rejects.toMatchObject({ status: 502 });
    mocks.result.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(listDocumentSections(owner, id)).rejects.toMatchObject({ status: 502, message: "Unable to load document sections." });
  });
});
