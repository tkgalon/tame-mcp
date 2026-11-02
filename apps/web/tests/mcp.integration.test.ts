import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { createCore, createDatabase } from "@tame/core";
import { decodeJwt } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTokenVerifier } from "../mcp/auth";
import { createMcpHandler } from "../mcp/handler";

// Uses the same local settings as the app, from apps/web/.env.local
function localEnv(): Record<string, string> {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const env = localEnv();
const supabaseUrl = env["NEXT_PUBLIC_SUPABASE_URL"]!;
const siteUrl = env["TAME_SITE_URL"]!;
const mcpUrl = `${siteUrl}/mcp`;
const redirectUri = "http://127.0.0.1:4321/callback";
const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const admin = createClient(supabaseUrl, env["TAME_SUPABASE_SECRET_KEY"]!, noSession);
const user = createClient(supabaseUrl, env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!, noSession);
const db = createDatabase(env["TAME_DATABASE_URL"]!);
const core = createCore({
  db,
  files: { createUploadUrl: async () => "", download: async () => null, remove: async () => {} },
  extract: async () => {
    throw new Error("Not used in this test.");
  },
});
const handler = createMcpHandler({
  core,
  siteUrl,
  verify: createTokenVerifier({
    supabaseUrl,
    audiences: [mcpUrl, "authenticated"],
    isSessionActive: (principal) => core.account.isSessionActive(principal),
  }),
});

const email = `oauth-${crypto.randomUUID()}@test.local`;
const password = "correct horse battery";
let userId = "";
const registeredClients: string[] = [];

type Metadata = { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };

async function authorize(): Promise<{ accessToken: string; clientId: string }> {
  // Same discovery order a real MCP client uses
  const metadata = (await discoverAuthorizationServerMetadata(`${supabaseUrl}/auth/v1`)) as Metadata;
  expect(metadata.registration_endpoint).toBeTruthy();

  const registration = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "TAME integration test",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registration.status).toBe(201);
  const clientId = ((await registration.json()) as { client_id: string }).client_id;
  registeredClients.push(clientId);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const start = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "integration",
    resource: mcpUrl,
  })) {
    start.searchParams.set(key, value);
  }
  const consent = await fetch(start, { redirect: "manual" });
  const authorizationId = new URL(consent.headers.get("location")!).searchParams.get("authorization_id")!;
  expect(authorizationId).toBeTruthy();

  const details = await user.auth.oauth.getAuthorizationDetails(authorizationId);
  expect(details.error).toBeNull();
  const approval = await user.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  expect(approval.error).toBeNull();
  const code = new URL(approval.data!.redirect_url).searchParams.get("code")!;

  const exchange = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: mcpUrl,
    }),
  });
  expect(exchange.status).toBe(200);
  return { accessToken: ((await exchange.json()) as { access_token: string }).access_token, clientId };
}

async function connect(accessToken: string) {
  const client = new Client({ name: "tame-integration", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: (url, init) => handler(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = created.data.user!.id;
  const signedIn = await user.auth.signInWithPassword({ email, password });
  expect(signedIn.error).toBeNull();
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  // Deleting the user removes consents and sessions, but registered clients stay unless removed
  for (const clientId of registeredClients) await admin.auth.admin.oauth.deleteClient(clientId);
  await db.destroy();
});

describe("MCP over OAuth", () => {
  it("registers a client, authorizes with PKCE, serves tools and stops after revocation", async () => {
    const { accessToken, clientId } = await authorize();
    const claims = decodeJwt(accessToken);
    expect(claims.aud).toBe("authenticated");
    expect(claims["client_id"]).toBe(clientId);
    expect(claims.sub).toBe(userId);

    const client = await connect(accessToken);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "draft_profile",
      "list_examples",
      "profile_history",
      "publish_profile",
      "read_example",
      "rollback_profile",
      "use_profile",
    ]);
    const used = await client.callTool({ name: "use_profile", arguments: { task: "CTF write-up" } });
    expect(used.structuredContent).toMatchObject({ status: "no_profiles" });
    await client.close();

    const revoked = await user.auth.oauth.revokeGrant({ clientId });
    expect(revoked.error).toBeNull();
    const after = await handler(
      new Request(mcpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(after.status).toBe(401);
  });
});
