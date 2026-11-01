import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), decide: vi.fn(), headers: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("../lib/oauth/consent", () => ({ decideConsent: mocks.decide }));
import { consentAction } from "../app/oauth/consent/actions";
const id = "A".repeat(32);
const form = () => { const data = new FormData(); data.set("authorizationId", id); data.set("decision", "approve"); return data; };
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("TAME_SITE_URL", "https://tame.example");
  mocks.headers.mockResolvedValue(new Headers({ Origin: "https://tame.example" }));
  mocks.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
  mocks.decide.mockResolvedValue("https://agent.example/callback?code=trusted");
});
it("checks origin and rejects invalid decisions before calling the provider", async () => {
  mocks.headers.mockResolvedValue(new Headers({ Origin: "https://evil.example" }));
  await expect(consentAction(form())).rejects.toThrow("error=unavailable");
  expect(mocks.decide).not.toHaveBeenCalled();
});
it("preserves the authorization request when login is required", async () => {
  mocks.user.mockResolvedValue(null);
  await expect(consentAction(form())).rejects.toThrow(`REDIRECT:/login?authorization_id=${id}`);
  expect(mocks.decide).not.toHaveBeenCalled();
});
it("uses verified identity and redirects only after completing the decision", async () => {
  await expect(consentAction(form())).rejects.toThrow("REDIRECT:https://agent.example/callback?code=trusted");
  expect(mocks.decide).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", id, true);
});
it("does not expose provider failures in the redirect", async () => {
  mocks.decide.mockRejectedValue(new Error("private provider response"));
  await expect(consentAction(form())).rejects.toThrow(`REDIRECT:/oauth/consent?authorization_id=${id}&error=unavailable`);
});
