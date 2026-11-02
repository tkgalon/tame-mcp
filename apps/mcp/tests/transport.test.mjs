import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../dist/app.js";
import { createAuthenticator } from "../dist/auth.js";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "55555555-5555-4555-8555-555555555555";
const clientId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const issuer = "https://project.supabase.co/auth/v1";
const keys = await generateKeyPair("ES256");
const jwk = await exportJWK(keys.publicKey);
jwk.kid = "transport-test";
const getKey = createLocalJWKSet({ keys: [jwk] });

async function withServer(body, configured = true) {
  let app;
  const server = createServer((request, response) => app(request, response));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = { revoked: false, permissions: ["read_examples"], lookups: 0 };
  const config = { resourceUrl: `${base}/mcp`, supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test-only", allowedOrigins: ["https://allowed.example"] };
  const authenticate = createAuthenticator(config, async identity => {
    state.lookups++;
    return state.revoked ? null : { id: connectionId, owner_id: identity.ownerId, client_id: identity.clientId, provider_session_id: identity.sessionId, permissions: state.permissions };
  }, getKey);
  app = createApp({ config: configured ? config : null, authenticate });
  const token = async (subject = owner) => new SignJWT({ sub: subject, client_id: clientId, session_id: sessionId, role: "authenticated" })
    .setIssuer(issuer).setAudience(config.resourceUrl).setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "ES256", kid: jwk.kid }).sign(keys.privateKey);
  try { await body({ base, state, token }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function connect(base, token) {
  const client = new Client({ name: "tame-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  return { client, transport };
}

test("real MCP SDK client initializes, lists tools, calls a tool, and observes live revocation", async () => {
  await withServer(async ({ base, state, token }) => {
    const accessToken = await token();
    const { client, transport } = connect(base, accessToken);
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().name, "tame-mcp");
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name), ["get_connection_info", "list_collections", "list_documents", "read_document", "get_profile_authoring_guide", "create_profile_draft", "get_profile_draft", "save_profile_version", "find_profiles", "get_profile"]);
      const result = await client.callTool({ name: "get_connection_info", arguments: {} });
      assert.deepEqual(result.structuredContent, { ownerId: owner, clientId, connectionId, permissions: ["read_examples"] });
      state.permissions = ["read_profiles"];
      assert.deepEqual((await client.callTool({ name: "get_connection_info", arguments: {} })).structuredContent.permissions, ["read_profiles"]);
      const forged = await client.callTool({ name: "get_connection_info", arguments: { ownerId: other } });
      assert.equal(forged.isError, true);
      state.revoked = true;
      await assert.rejects(client.callTool({ name: "get_connection_info", arguments: {} }));
      assert.ok(state.lookups >= 5);
    } finally { await client.close(); }
  });
});

test("stateless concurrent clients never share their verified account context", async () => {
  await withServer(async ({ base, token }) => {
    const clients = [connect(base, await token(owner)), connect(base, await token(other))];
    try {
      await Promise.all(clients.map(({ client, transport }) => client.connect(transport)));
      const results = await Promise.all(clients.map(({ client }) => client.callTool({ name: "get_connection_info", arguments: {} })));
      assert.deepEqual(results.map(result => result.structuredContent.ownerId), [owner, other]);
    } finally { await Promise.all(clients.map(({ client }) => client.close())); }
  });
});

test("discovery uses configured URLs and bearer challenges do not accept web cookies", async () => {
  await withServer(async ({ base }) => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      const metadata = await response.json();
      assert.equal(metadata.resource, `${base}/mcp`);
      assert.deepEqual(metadata.authorization_servers, [issuer]);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    const denied = await fetch(`${base}/mcp`, { method: "POST", headers: { Cookie: "web-session=not-a-bearer-token" } });
    assert.equal(denied.status, 401);
    assert.ok(denied.headers.get("WWW-Authenticate").includes(`${base}/.well-known/oauth-protected-resource/mcp`));
    assert.deepEqual(await denied.json(), { error: "invalid_token" });
  });
});

test("host, origin and preflight checks happen before authentication", async () => {
  await withServer(async ({ base, state }) => {
    const hostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${base}/mcp`, { method: "POST", headers: { Host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
      request.end();
    });
    assert.equal(hostStatus, 403);
    const duplicateStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${base}/mcp`, { method: "POST", headers: ["Host", new URL(base).host, "Authorization", "Bearer first", "Authorization", "Bearer second"] }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
      request.end();
    });
    assert.equal(duplicateStatus, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
    const preflight = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "https://allowed.example" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://allowed.example");
    assert.equal(state.lookups, 0);
  });
});

test("malformed and oversized bodies stay bounded and unsupported methods return 405", async () => {
  await withServer(async ({ base, token }) => {
    const authorization = `Bearer ${await token()}`;
    const headers = { Authorization: authorization, "Content-Type": "application/json" };
    const invalid = await fetch(`${base}/mcp`, { method: "POST", headers, body: "private invalid JSON" });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.stringify(await invalid.json()).includes("private"), false);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ payload: "x".repeat(65536) }) })).status, 413);
    for (const method of ["GET", "DELETE"]) assert.equal((await fetch(`${base}/mcp`, { method, headers })).status, 405);
  });
});

test("missing configuration keeps MCP unavailable while liveness stays public", async () => {
  await withServer(async ({ base }) => {
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: "ok", service: "mcp" });
    assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 503);
    assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).status, 503);
  }, false);
});
