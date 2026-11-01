import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(),
  order: vi.fn(), range: vi.fn(), insert: vi.fn(), single: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { createCollection, listCollections } from "../lib/collections/data";
import { collectionNameSchema, readCollectionPage } from "../lib/collections/schema";

const owner = "11111111-1111-4111-8111-111111111111";
const row = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "CTF examples",
  created_at: "2026-11-01T08:00:00+00:00",
};

beforeEach(() => {
  const query = { select: mocks.select, eq: mocks.eq, order: mocks.order, range: mocks.range, insert: mocks.insert, single: mocks.single };
  mocks.createClient.mockResolvedValue({ from: mocks.from });
  for (const mock of [mocks.from, mocks.select, mocks.eq, mocks.order, mocks.insert]) mock.mockReturnValue(query);
  mocks.range.mockResolvedValue({ data: [], error: null });
  mocks.single.mockResolvedValue({ data: row, error: null });
});

describe("collection input", () => {
  it("normalizes outer whitespace and rejects empty or invalid names", () => {
    expect(collectionNameSchema.parse("  CTF examples  ")).toBe("CTF examples");
    for (const name of ["", "   ", "x".repeat(121), "name\nwith newline", "name\0with null"]) {
      expect(collectionNameSchema.safeParse(name).success).toBe(false);
    }
    expect(collectionNameSchema.safeParse("x".repeat(120)).success).toBe(true);
  });

  it("bounds pagination and rejects ambiguous or malformed query values", () => {
    expect(readCollectionPage("2")).toBe(2);
    for (const value of [undefined, ["2", "3"], "0", "-1", "1.5", "1e2", "10001", "not-a-page"]) {
      expect(readCollectionPage(value)).toBe(1);
    }
  });
});

describe("collection reads", () => {
  it("uses the session client and an explicit owner filter", async () => {
    mocks.range.mockResolvedValue({ data: [row], error: null });
    expect(await listCollections(owner)).toEqual({ items: [row], hasNextPage: false });
    expect(mocks.createClient).toHaveBeenCalledWith({ readOnly: true });
    expect(mocks.from).toHaveBeenCalledWith("collections");
    expect(mocks.eq).toHaveBeenCalledWith("owner_id", owner);
  });

  it("paginates with a stable tie-breaker and one extra row", async () => {
    mocks.range.mockResolvedValue({ data: Array.from({ length: 21 }, () => row), error: null });
    const result = await listCollections(owner, 2);
    expect(result.items).toHaveLength(20);
    expect(result.hasNextPage).toBe(true);
    expect(mocks.range).toHaveBeenCalledWith(20, 40);
    expect(mocks.order.mock.calls).toEqual([
      ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
  });

  it("keeps an empty collection list distinct from failure", async () => {
    expect(await listCollections(owner)).toEqual({ items: [], hasNextPage: false });
    mocks.range.mockResolvedValue({ data: null, error: { message: "private provider details" } });
    await expect(listCollections(owner)).rejects.toThrow("Unable to load collections.");
  });

  it("rejects malformed provider rows", async () => {
    mocks.range.mockResolvedValue({ data: [{ id: "invalid", name: "bad" }], error: null });
    await expect(listCollections(owner)).rejects.toThrow("Invalid collections response.");
  });
});

describe("collection creation", () => {
  it("writes only the verified owner and normalized name", async () => {
    expect(await createCollection(owner, "  CTF examples  ")).toEqual(row);
    expect(mocks.insert).toHaveBeenCalledWith({ owner_id: owner, name: "CTF examples" });
  });

  it("rejects invalid input before making a database request", async () => {
    await expect(createCollection(owner, " ")).rejects.toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not return success on database or response validation failure", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "private details" } });
    await expect(createCollection(owner, "name")).rejects.toThrow("Unable to create collection.");
    mocks.single.mockResolvedValue({ data: { name: "missing id" }, error: null });
    await expect(createCollection(owner, "name")).rejects.toThrow("Invalid collection response.");
  });
});
