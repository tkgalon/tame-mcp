import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer, CookieOptions } from "@supabase/ssr";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), cookieSet: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: mocks.cookieSet }) }));

import { updateSession } from "../lib/supabase/proxy";
import { createSupabaseServerClient } from "../lib/supabase/server";

function clientOptions() {
  return mocks.createClient.mock.calls.at(-1)?.[2] as {
    cookies: CookieMethodsServer;
    cookieOptions: CookieOptions;
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-only");
  vi.stubEnv("TAME_SITE_URL", "https://tame.example");
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("request session refresh", () => {
  it("keeps refreshed cookies on request and response across multiple writes", async () => {
    const request = new NextRequest("https://tame.example/");
    mocks.getUser.mockImplementation(async () => {
      const { cookies } = clientOptions();
      await cookies.setAll?.([{ name: "session", value: "refreshed", options: { httpOnly: true, path: "/", secure: true } }], {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        "Expires": "0",
        "Pragma": "no-cache",
      });
      await cookies.setAll?.([{ name: "verifier", value: "", options: { path: "/", maxAge: 0 } }], {});
      return { data: { user: { id: "user" } }, error: null };
    });
    const response = await updateSession(request);
    expect(request.cookies.get("session")?.value).toBe("refreshed");
    expect(response.cookies.get("session")?.value).toBe("refreshed");
    expect(response.cookies.get("session")?.httpOnly).toBe(true);
    expect(response.cookies.get("verifier")?.maxAge).toBe(0);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  it("does not contact Supabase without configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await updateSession(new NextRequest("http://localhost:3000/"));
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("server client cookies", () => {
  it("sets server-only session cookie options and writes through action cookie store", async () => {
    await createSupabaseServerClient();
    const options = clientOptions();
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
    await options.cookies.setAll?.([{ name: "session", value: "new", options: { httpOnly: true } }], {});
    expect(mocks.cookieSet).toHaveBeenCalledWith("session", "new", { httpOnly: true });
  });

  it("does not attempt cookie writes from Server Components", async () => {
    await createSupabaseServerClient({ readOnly: true });
    await clientOptions().cookies.setAll?.([{ name: "session", value: "new", options: {} }], {});
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("keeps local HTTP development cookies usable", async () => {
    vi.stubEnv("TAME_SITE_URL", "http://localhost:3000");
    await createSupabaseServerClient();
    expect(clientOptions().cookieOptions.secure).toBe(false);
  });
});
