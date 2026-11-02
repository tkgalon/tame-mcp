import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTokenVerifier } from "../mcp/auth";

const supabaseUrl = "http://127.0.0.1:54321";
const audience = "http://localhost:3000/mcp";
const ids = {
  sub: "11111111-1111-4111-8111-111111111111",
  client_id: "22222222-2222-4222-8222-222222222222",
  session_id: "33333333-3333-4333-8333-333333333333",
};

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256" }] });
});

function token(claims: Record<string, unknown>, issuer = `${supabaseUrl}/auth/v1`) {
  return new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function verifier(isSessionActive = vi.fn(async () => true)) {
  return createTokenVerifier({ supabaseUrl, audiences: [audience], isSessionActive, keys });
}

describe("createTokenVerifier", () => {
  it("accepts an OAuth token with an active session", async () => {
    const principal = await verifier()(`Bearer ${await token(ids)}`);
    expect(principal).toEqual({ ownerId: ids.sub, clientId: ids.client_id, sessionId: ids.session_id });
  });

  it("rejects browser session tokens without client_id", async () => {
    const { client_id: _clientId, ...browser } = ids;
    expect(await verifier()(`Bearer ${await token(browser)}`)).toBeNull();
  });

  it("rejects tokens from another issuer", async () => {
    expect(await verifier()(`Bearer ${await token(ids, "https://evil.example/auth/v1")}`)).toBeNull();
  });

  it("rejects a valid token once the session was revoked", async () => {
    const revoked = vi.fn(async () => false);
    expect(await verifier(revoked)(`Bearer ${await token(ids)}`)).toBeNull();
    expect(revoked).toHaveBeenCalledOnce();
  });

  it("rejects missing or malformed headers without checking the session", async () => {
    const check = vi.fn(async () => true);
    expect(await verifier(check)(null)).toBeNull();
    expect(await verifier(check)("Basic abc")).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});
