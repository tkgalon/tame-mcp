import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), detail: vi.fn(), sections: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("../lib/documents/read", () => ({ getDocument: mocks.detail, listDocumentSections: mocks.sections }));
import { GET as detail } from "../app/api/documents/[documentId]/route";
import { GET as sections } from "../app/api/documents/[documentId]/sections/route";
import { ApiError } from "../lib/http/api";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ documentId: id }) };
const request = (query = "") => new Request(`https://tame.example/api/documents/${id}/sections${query}`);
beforeEach(() => {
  mocks.user.mockResolvedValue({ id: owner });
  mocks.detail.mockResolvedValue({ id, status: "processing" });
  mocks.sections.mockResolvedValue({ items: [], extractionVersion: 1, nextAfter: null });
});
it("requires authentication and returns uncached JSON without redirects", async () => {
  mocks.user.mockResolvedValue(null);
  for (const handler of [detail, sections]) {
    const response = await handler(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.sections).not.toHaveBeenCalled();
});
it("takes identity from the session and validates document IDs", async () => {
  const response = await detail(request("?ownerId=forged"), context);
  expect(await response.json()).toEqual({ document: { id, status: "processing" } });
  expect(mocks.detail).toHaveBeenCalledWith(owner, id);
  for (const handler of [detail, sections]) expect((await handler(request(), { params: Promise.resolve({ documentId: "invalid" }) })).status).toBe(400);
});
it("passes a validated cursor and extraction version to the read layer", async () => {
  const response = await sections(request("?version=1&after=0"), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.sections).toHaveBeenCalledWith(owner, id, { version: 1, after: 0 });
  for (const query of ["?after=0", "?version=0", "?version=1&after=-1", "?version=1&after=", "?version=1e0"]) {
    expect((await sections(request(query), context)).status).toBe(400);
  }
});
it("preserves not-found and version-conflict errors without exposing private failures", async () => {
  mocks.detail.mockRejectedValue(new ApiError(404, "not_found", "Document not found."));
  expect((await detail(request(), context)).status).toBe(404);
  mocks.sections.mockRejectedValue(new ApiError(409, "extraction_changed", "Restart pagination."));
  expect((await sections(request(), context)).status).toBe(409);
  mocks.sections.mockRejectedValue(new Error("private upstream detail"));
  const response = await sections(request(), context);
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("private upstream detail");
});
