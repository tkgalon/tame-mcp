import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedUser: mocks.user }));

import { apiFailure, ApiError, readJsonBody, requireApiUser, requireSameOrigin } from "../lib/http/api";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("TAME_SITE_URL", "https://tame.example");
});

describe("API boundaries", () => {
  it("returns JSON errors with no-store and hides unexpected details", async () => {
    const response = apiFailure(new Error("private credentials"));
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private credentials");
    expect(apiFailure(new ApiError(404, "not_found", "Missing document.")).status).toBe(404);
  });

  it("requires an authenticated user rather than redirecting an API request", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(requireApiUser()).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    mocks.user.mockResolvedValue({ id: "verified" });
    expect(await requireApiUser()).toEqual({ id: "verified" });
  });

  it("allows mutation requests only from the configured origin", () => {
    const request = (origin?: string) => new Request("https://tame.example/api/documents", {
      method: "POST", headers: origin ? { origin } : {},
    });
    expect(() => requireSameOrigin(request("https://tame.example"))).not.toThrow();
    for (const origin of [undefined, "null", "https://evil.example", "https://tame.example.evil.example"]) {
      expect(() => requireSameOrigin(request(origin))).toThrow(ApiError);
    }
  });
});

describe("bounded JSON metadata", () => {
  const request = (body: BodyInit, headers: Record<string, string> = { "content-type": "application/json" }) => new Request("https://tame.example/api", { method: "POST", headers, body });

  it("parses valid metadata", async () => {
    expect(await readJsonBody(request('{"name":"example.md"}'))).toEqual({ name: "example.md" });
  });

  it("rejects unsupported content types and malformed JSON", async () => {
    await expect(readJsonBody(request("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    await expect(readJsonBody(request("{"))).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(request(new Uint8Array([0xff])))).rejects.toMatchObject({ status: 400 });
  });

  it("enforces byte limits with and without a content-length header", async () => {
    await expect(readJsonBody(request("{}", { "content-type": "application/json", "content-length": "10000" }))).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(request('"éééé"'), 8)).rejects.toMatchObject({ status: 413 });
  });
});
