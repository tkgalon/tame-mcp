import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("../lib/documents/data", () => ({ listDocuments: mocks.list }));

import { GET } from "../app/api/collections/[collectionId]/documents/route";
import { ApiError } from "../lib/http/api";

const owner = "11111111-1111-4111-8111-111111111111";
const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = { params: Promise.resolve({ collectionId: collection }) };

beforeEach(() => {
  mocks.user.mockResolvedValue({ id: owner });
  mocks.list.mockResolvedValue({ items: [], page: 1, hasNextPage: false });
});

it("returns JSON 401 without redirecting anonymous callers", async () => {
  mocks.user.mockResolvedValue(null);
  const response = await GET(new Request(`https://tame.example/api/collections/${collection}/documents`), context);
  expect(response.status).toBe(401);
  expect(response.headers.get("location")).toBeNull();
  expect(mocks.list).not.toHaveBeenCalled();
});

it("uses verified identity and validates pagination", async () => {
  const response = await GET(new Request(`https://tame.example/api/collections/${collection}/documents?page=2`), context);
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(owner, collection, 2);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect((await GET(new Request("https://tame.example/api?page=-1"), context)).status).toBe(400);
});

it("preserves not-found without revealing private provider errors", async () => {
  mocks.list.mockRejectedValue(new ApiError(404, "not_found", "Collection not found."));
  expect((await GET(new Request("https://tame.example/api"), context)).status).toBe(404);
  mocks.list.mockRejectedValue(new Error("private upstream detail"));
  const response = await GET(new Request("https://tame.example/api"), context);
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("private upstream detail");
});
