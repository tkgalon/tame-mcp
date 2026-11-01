import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), register: vi.fn(), sign: vi.fn(), complete: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("../lib/documents/data", () => ({ registerUpload: mocks.register, createUploadUrl: mocks.sign, completeUpload: mocks.complete }));

import { POST as register } from "../app/api/collections/[collectionId]/uploads/route";
import { POST as sign } from "../app/api/documents/[documentId]/upload-url/route";
import { POST as complete } from "../app/api/documents/[documentId]/complete/route";

const owner = "11111111-1111-4111-8111-111111111111";
const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const document = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const collectionContext = { params: Promise.resolve({ collectionId: collection }) };
const documentContext = { params: Promise.resolve({ documentId: document }) };

function request(body?: unknown, origin = "https://tame.example") {
  return new Request("https://tame.example/api", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("TAME_SITE_URL", "https://tame.example");
  mocks.user.mockResolvedValue({ id: owner });
  mocks.register.mockResolvedValue({ id: document, status: "uploading" });
  mocks.sign.mockResolvedValue({ path: "registered-path", token: "test", signedUrl: "https://example.supabase.co/upload" });
  mocks.complete.mockResolvedValue({ id: document, status: "uploaded" });
});

describe("upload registration route", () => {
  it("takes the collection from the URL and owner from the session", async () => {
    const response = await register(request({ name: "example.md", sizeBytes: 100, ownerId: "forged", collectionId: "forged", mediaType: "forged" }), collectionContext);
    expect(response.status).toBe(201);
    expect(mocks.register).toHaveBeenCalledWith(owner, { collectionId: collection, name: "example.md", sizeBytes: 100, mediaType: "text/markdown" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects anonymous, cross-origin, and invalid requests before a write", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await register(request({ name: "example.md", sizeBytes: 1 }), collectionContext)).status).toBe(401);
    mocks.user.mockResolvedValue({ id: owner });
    expect((await register(request({}, "https://evil.example"), collectionContext)).status).toBe(403);
    expect((await register(request({ name: "payload.exe", sizeBytes: 1 }), collectionContext)).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("signing and confirmation routes", () => {
  it("signs and confirms only for a verified session", async () => {
    expect((await sign(request(), documentContext)).status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledWith(owner, document);
    const response = await complete(request(), documentContext);
    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(owner, document);
  });

  it("enforces origin and ID checks on both mutation endpoints", async () => {
    expect((await sign(request(undefined, "https://evil.example"), documentContext)).status).toBe(403);
    expect((await complete(request(undefined, "https://evil.example"), documentContext)).status).toBe(403);
    const invalid = { params: Promise.resolve({ documentId: "invalid" }) };
    expect((await sign(request(), invalid)).status).toBe(400);
    expect((await complete(request(), invalid)).status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
