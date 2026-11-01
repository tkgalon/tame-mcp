import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), exchange: vi.fn(), getUser: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
  revalidate: vi.fn(), createClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { signInAction, signUpAction, signOutAction } from "../app/auth/actions";
import { GET } from "../app/auth/callback/route";
import { getAuthenticatedUser, requireUser } from "../lib/auth/session";
import { initialAuthState } from "../lib/auth/form";

function credentials() {
  const data = new FormData();
  data.set("email", "user@example.com");
  data.set("password", "example-password");
  return data;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-only");
  vi.stubEnv("TAME_SITE_URL", "https://tame.example");
  mocks.createClient.mockResolvedValue({ auth: {
    signInWithPassword: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut,
    exchangeCodeForSession: mocks.exchange, getUser: mocks.getUser,
  } });
});

describe("authentication actions", () => {
  it("does not call the provider without configuration or valid input", async () => {
    expect((await signInAction(initialAuthState, new FormData())).status).toBe("error");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect((await signInAction(initialAuthState, credentials())).status).toBe("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("redirects only after successful sign-in", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    await expect(signInAction(initialAuthState, credentials())).rejects.toThrow("REDIRECT:/");
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "user@example.com", password: "example-password" });
  });

  it("continues only to a validated OAuth request after sign-in", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    const data = credentials();
    data.set("authorizationId", "A".repeat(32));
    await expect(signInAction(initialAuthState, data)).rejects.toThrow(`REDIRECT:/oauth/consent?authorization_id=${"A".repeat(32)}`);
    data.set("authorizationId", "https://evil.example");
    await expect(signInAction(initialAuthState, data)).rejects.toThrow("REDIRECT:/");
  });

  it("keeps provider errors out of UI and never redirects on failure", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "sensitive upstream details" } });
    const state = await signInAction(initialAuthState, credentials());
    expect(state.status).toBe("error");
    expect(state.message).not.toContain("sensitive");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("handles network failure without granting a session", async () => {
    mocks.signIn.mockRejectedValue(new Error("connection failed"));
    expect((await signInAction(initialAuthState, credentials())).status).toBe("error");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("uses a configured confirmation URL and waits when no session is issued", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect((await signUpAction(initialAuthState, credentials())).status).toBe("success");
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { emailRedirectTo: "https://tame.example/auth/callback" },
    }));
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("enters the private page when signup issues a session", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
    await expect(signUpAction(initialAuthState, credentials())).rejects.toThrow("REDIRECT:/");
  });

  it("logs out only the current session", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(signOutAction(initialAuthState, new FormData())).rejects.toThrow("REDIRECT:/login");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("reports logout failure without pretending it succeeded", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "failure" } });
    expect((await signOutAction(initialAuthState, new FormData())).status).toBe("error");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("private session boundary", () => {
  it("uses server-confirmed user data and fails closed on rejected session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
    expect(await getAuthenticatedUser()).toEqual({ id: "user-id" });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "untrusted" } }, error: { message: "revoked" } });
    expect(await getAuthenticatedUser()).toBeNull();
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("confirmation callback", () => {
  it("rejects a missing code before contacting Supabase", async () => {
    await expect(GET(new NextRequest("https://tame.example/auth/callback"))).rejects.toThrow("REDIRECT:/login?error=confirmation");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("ignores external redirect targets and only exchanges the code", async () => {
    mocks.exchange.mockResolvedValue({ error: null });
    await expect(GET(new NextRequest("https://tame.example/auth/callback?code=valid-code&next=https://evil.example"))).rejects.toThrow("REDIRECT:/");
    expect(mocks.exchange).toHaveBeenCalledWith("valid-code");
  });

  it("does not admit failed confirmations", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
    await expect(GET(new NextRequest("https://tame.example/auth/callback?code=expired"))).rejects.toThrow("REDIRECT:/login?error=confirmation");
  });
});
