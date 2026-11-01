import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAuthenticator, AuthFailure } from "../dist/auth.js";
import { createGrantResolver } from "../dist/grants.js";
import { readMcpConfig } from "../dist/config.js";

const config = { resourceUrl: "https://tame.example/mcp", supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test-only", allowedOrigins: [] };
const owner = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const grant = { id: "44444444-4444-4444-8444-444444444444", owner_id: owner, client_id: client, provider_session_id: session, permissions: ["read_examples"] };
const keys = await generateKeyPair("ES256");
const jwk = await exportJWK(keys.publicKey);
jwk.kid = "test-key";
const getKey = createLocalJWKSet({ keys: [jwk] });
async function sign(overrides = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: owner, client_id: client, session_id: session, role: "authenticated", iat: now, exp: now + 300, iss: `${config.supabaseUrl}/auth/v1`, aud: config.resourceUrl, ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" }).sign(signingKey);
}

test("configuration requires HTTPS or loopback and keeps backend secrets separate", () => {
  const env = { TAME_MCP_URL: config.resourceUrl, TAME_SUPABASE_URL: config.supabaseUrl, TAME_SUPABASE_SECRET_KEY: config.secretKey };
  assert.ok(readMcpConfig(env));
  assert.equal(readMcpConfig({}), null);
  for (const values of [{ TAME_MCP_URL: "not a URL" }, { TAME_MCP_URL: "http://remote.example/mcp" }, { TAME_MCP_URL: "https://tame.example/other" }, { TAME_SUPABASE_SECRET_KEY: "sb_publishable_public" }, { MCP_ALLOWED_ORIGINS: "https://bad.example/path" }]) {
    assert.equal(readMcpConfig({ ...env, ...values }), null);
  }
});

test("valid signed resource-bound tokens derive identity before resolving grants", async () => {
  const authenticate = createAuthenticator(config, async identity => {
    assert.deepEqual(identity, { ownerId: owner, clientId: client, sessionId: session });
    return grant;
  }, getKey);
  assert.deepEqual(await authenticate(`Bearer ${await sign()}`), { ownerId: owner, clientId: client, sessionId: session, connectionId: grant.id, permissions: grant.permissions });
});

test("expired, wrong-audience, wrong-issuer, web-session and malformed tokens never reach grants", async () => {
  let calls = 0;
  const authenticate = createAuthenticator(config, async () => { calls++; return grant; }, getKey);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { aud: "authenticated" }, { aud: "https://other.example/mcp" }, { iss: "https://evil.example/auth/v1" },
    { exp: now - 60 }, { iat: now + 60, exp: now + 300 }, { client_id: undefined }, { session_id: null },
    { role: "service_role" }, { is_anonymous: true }, { sub: "not-a-user" },
  ]) await assert.rejects(authenticate(`Bearer ${await sign(claims)}`), error => error.status === 401);
  for (const value of [undefined, "", "Basic secret", "Bearer invalid", "Bearer a,b", "Bearer a b"]) await assert.rejects(authenticate(value), error => error.status === 401);
  const wrongKeys = await generateKeyPair("ES256");
  await assert.rejects(authenticate(`Bearer ${await sign({}, wrongKeys.privateKey)}`), error => error.status === 401);
  const hmac = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("a".repeat(32)));
  await assert.rejects(authenticate(`Bearer ${hmac}`), error => error.status === 401);
  assert.equal(calls, 0);
});

test("revocation applies to an already verified and unexpired token", async () => {
  let active = true;
  let calls = 0;
  const authenticate = createAuthenticator(config, async () => { calls++; return active ? grant : null; }, getKey);
  const token = await sign();
  assert.ok(await authenticate(`Bearer ${token}`));
  active = false;
  await assert.rejects(authenticate(`Bearer ${token}`), error => error.status === 401);
  assert.equal(calls, 2);
});

test("grant outages and identity mismatches fail closed without leaking details", async () => {
  for (const resolver of [async () => { throw new Error("private provider details"); }, async () => ({ ...grant, owner_id: client })]) {
    await assert.rejects(createAuthenticator(config, resolver, getKey)(`Bearer ${await sign()}`), error => error.status === 503 && error.message === "auth_unavailable");
  }
});

test("grant lookup uses only server credentials and verified identity, with bounded responses", async () => {
  const identity = { ownerId: owner, clientId: client, sessionId: session };
  const resolve = createGrantResolver(config, async (url, init) => {
    assert.equal(url, `${config.supabaseUrl}/rest/v1/rpc/resolve_mcp_connection`);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.apikey, config.secretKey);
    assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), { p_owner_id: owner, p_client_id: client, p_session_id: session });
    return Response.json(grant);
  });
  assert.deepEqual(await resolve(identity), grant);
  assert.equal(await createGrantResolver(config, async () => Response.json(null))(identity), null);
  for (const response of [() => new Response("private upstream failure", { status: 500 }), () => new Response("x".repeat(16385)), () => Response.json({ owner_id: owner })]) {
    await assert.rejects(createGrantResolver(config, async () => response())(identity), error => error instanceof AuthFailure && error.status === 503);
  }
});
