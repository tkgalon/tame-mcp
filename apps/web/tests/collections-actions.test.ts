import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), create: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("../lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("../lib/collections/data", () => ({ createCollection: mocks.create }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createCollectionAction } from "../app/collections/actions";
import { initialCollectionState } from "../lib/collections/schema";

const owner = "11111111-1111-4111-8111-111111111111";
function form(name: string) {
  const data = new FormData();
  data.set("name", name);
  return data;
}

beforeEach(() => {
  mocks.requireUser.mockResolvedValue({ id: owner });
  mocks.create.mockResolvedValue({ id: "collection-id", name: "CTF" });
});

describe("create collection action", () => {
  it("checks authentication before any write", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(createCollectionAction(initialCollectionState, form("CTF"))).rejects.toThrow("REDIRECT:/login");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores a forged owner field and uses the authenticated identity", async () => {
    const data = form("  CTF  ");
    data.set("owner_id", "22222222-2222-4222-8222-222222222222");
    await expect(createCollectionAction(initialCollectionState, data)).rejects.toThrow("REDIRECT:/collections");
    expect(mocks.create).toHaveBeenCalledWith(owner, "CTF");
    expect(mocks.revalidate).toHaveBeenCalledWith("/collections");
  });

  it("rejects invalid and file input without writing", async () => {
    expect((await createCollectionAction(initialCollectionState, form("   "))).status).toBe("error");
    const data = form("CTF");
    data.set("name", new File(["CTF"], "name.txt"));
    expect((await createCollectionAction(initialCollectionState, data)).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps provider errors private and does not redirect on failed creation", async () => {
    mocks.create.mockRejectedValue(new Error("sensitive database details"));
    const result = await createCollectionAction(initialCollectionState, form("CTF"));
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("sensitive");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
