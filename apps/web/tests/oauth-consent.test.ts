import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), details: vi.fn(), approve: vi.fn(), deny: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { decideConsent, getConsentContext } from "../lib/oauth/consent";
import { callbackFor, consentPath } from "../lib/oauth/schema";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "A".repeat(32);
const pending = { authorization_id: id, client_id: "22222222-2222-4222-8222-222222222222", client_name: "Test agent", resource_url: "https://tame.example/mcp", redirect_uri: "http://127.0.0.1:4400/callback?existing=1", scope: "openid", state: "verified-state", status: "pending" as const, user_id: null, authorization_code: null };
const bound = { ...pending, user_id: owner };
const approved = { ...bound, status: "approved" as const, authorization_code: "private-test-code" };
let contexts: unknown[];
beforeEach(() => {
  contexts = [pending];
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "approve_mcp_oauth_consent" ? true : contexts.shift(), error: null }));
  for (const fn of [mocks.details, mocks.approve, mocks.deny]) fn.mockResolvedValue({ data: {}, error: null });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, auth: { oauth: { getAuthorizationDetails: mocks.details, approveAuthorization: mocks.approve, denyAuthorization: mocks.deny } } });
});
it("returns only fixed local continuation paths for validated authorization IDs", () => {
  expect(consentPath(id)).toBe(`/oauth/consent?authorization_id=${id}`);
  for (const input of ["https://evil.example", "//evil.example", "../other", null]) expect(consentPath(input)).toBe("/");
});
it("loads trusted context and rejects owner or authorization mismatches", async () => {
  expect((await getConsentContext(owner, id)).client_id).toBe(pending.client_id);
  contexts = [{ ...bound, user_id: pending.client_id }];
  await expect(getConsentContext(owner, id)).rejects.toMatchObject({ status: 502 });
  contexts = [{ ...pending, authorization_id: "B".repeat(32) }];
  await expect(getConsentContext(owner, id)).rejects.toMatchObject({ status: 502 });
});
it("handles provider approval then stores app consent before returning a code", async () => {
  contexts = [pending, bound, approved];
  const result = await decideConsent(owner, id, true);
  expect(mocks.details).toHaveBeenCalledWith(id);
  expect(mocks.approve).toHaveBeenCalledWith(id, { skipBrowserRedirect: true });
  expect(mocks.rpc).toHaveBeenCalledWith("approve_mcp_oauth_consent", { p_authorization_id: id });
  expect(new URL(result).searchParams.get("code")).toBe("private-test-code");
  expect(new URL(result).searchParams.get("state")).toBe("verified-state");
});
it("does not let provider auto-approval bypass TAME consent", async () => {
  contexts = [pending, approved, approved];
  const result = await decideConsent(owner, id, true);
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("approve_mcp_oauth_consent", { p_authorization_id: id });
  expect(new URL(result).searchParams.has("code")).toBe(true);
});
it("denies pending requests and never stores application approval", async () => {
  contexts = [pending, bound];
  const result = await decideConsent(owner, id, false);
  expect(mocks.deny).toHaveBeenCalledWith(id, { skipBrowserRedirect: true });
  expect(mocks.rpc.mock.calls.some(([name]) => name === "approve_mcp_oauth_consent")).toBe(false);
  expect(new URL(result).searchParams.get("error")).toBe("access_denied");
  expect(new URL(result).searchParams.has("code")).toBe(false);
});
it("a denial after provider auto-approval does not expose the pre-issued code", async () => {
  contexts = [pending, approved];
  const result = await decideConsent(owner, id, false);
  expect(mocks.deny).not.toHaveBeenCalled();
  expect(new URL(result).searchParams.has("code")).toBe(false);
});
it("fails closed when saving TAME consent fails", async () => {
  contexts = [approved];
  mocks.rpc.mockImplementation(async (name: string) => name === "approve_mcp_oauth_consent" ? { data: null, error: { message: "private detail" } } : { data: contexts.shift(), error: null });
  await expect(decideConsent(owner, id, true)).rejects.toMatchObject({ status: 502, message: "Unable to save application consent." });
});
it("callback URLs preserve registered parameters and overwrite reserved OAuth fields", () => {
  const result = callbackFor({ ...approved, redirect_uri: "https://agent.example/callback?code=forged&state=forged&existing=1" }, true);
  const params = new URL(result).searchParams;
  expect(params.getAll("code")).toEqual(["private-test-code"]);
  expect(params.getAll("state")).toEqual(["verified-state"]);
  expect(params.get("existing")).toBe("1");
});
