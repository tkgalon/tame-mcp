import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startOAuthTestProvider } from "./oauth-test-provider.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDirectory = process.env.TAME_TEST_WEB_DIR ?? join(repo, "apps/web");
const mcpDirectory = process.env.TAME_TEST_MCP_DIR ?? join(repo, "apps/mcp");
const { createClient } = createRequire(join(repo, "apps/web/package.json"))("@supabase/supabase-js");
const requireMcp = createRequire(join(repo, "apps/mcp/package.json"));
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = requireMcp("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } = requireMcp("@modelcontextprotocol/sdk/client/auth.js");
const { createApp } = await import(pathToFileURL(join(mcpDirectory, "dist/app.js")).href);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const check = (condition, message) => { if (!condition) throw new Error(message); };
const cookieJar = new Map();
function hiddenFields(html) {
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  check(form, "Expected a functional HTML form.");
  const data = new FormData();
  const decode = value => value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
  for (const input of form.matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...input[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map(item => [item[1], decode(item[2])]));
    if (attrs.type === "hidden" && attrs.name) data.append(attrs.name, attrs.value ?? "");
  }
  return data;
}
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function run() {
  const site = `http://127.0.0.1:${await freePort()}`;
  const provider = await startOAuthTestProvider(site);
  const admin = createClient(provider.url, provider.secretKey, options);
  const owner = createClient(provider.url, provider.publicKey, options);
  let userId, otherUserId, clientId, web, mcpServer, sdk;
  let webExited = false;
  async function endpoint(path, init = {}) {
    const response = await fetch(site + path, {
      ...init, redirect: "manual", headers: { Cookie: [...cookieJar].map(([key, value]) => `${key}=${value}`).join("; "), ...init.headers },
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const index = pair.indexOf("=");
      const key = pair.slice(0, index), content = pair.slice(index + 1);
      if (!content || /max-age=0/i.test(value)) cookieJar.delete(key); else cookieJar.set(key, content);
    }
    return response;
  }
  try {
    let app;
    mcpServer = createServer((request, response) => app(request, response));
    await new Promise(resolve => mcpServer.listen(0, "127.0.0.1", resolve));
    const resource = `http://127.0.0.1:${mcpServer.address().port}/mcp`;
    app = createApp({ config: { resourceUrl: resource, supabaseUrl: provider.url, secretKey: provider.secretKey, allowedOrigins: [] } });
    const protectedResource = await discoverOAuthProtectedResourceMetadata(resource);
    const authorizationServer = await discoverAuthorizationServerMetadata(protectedResource.authorization_servers[0]);
    check(protectedResource.resource === resource && authorizationServer.issuer === `${provider.url}/auth/v1`, "SDK discovery did not resolve the expected resource and issuer.");
    const email = `tame-oauth-${randomUUID()}@example.invalid`, password = `Test-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    check(!created.error && created.data.user, "Temporary user creation failed.");
    userId = created.data.user.id;
    const session = await owner.auth.signInWithPassword({ email, password });
    check(!session.error, "Temporary owner login failed.");
    const webToken = session.data.session.access_token;
    const collection = await owner.from("collections").insert({ name: "Private OAuth fixture" }).select("id").single();
    check(!collection.error && collection.data, "Private fixture collection creation failed.");
    const registered = await admin.auth.admin.oauth.createClient({ client_name: "TAME OAuth integration agent", redirect_uris: ["http://127.0.0.1:4400/callback"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });
    check(!registered.error && registered.data, "Temporary OAuth client creation failed.");
    clientId = registered.data.client_id;
    check(!(await admin.from("mcp_oauth_clients").insert({ client_id: clientId, resource_url: resource })).error, "Apply OAuth migrations before testing.");
    web = spawn(process.execPath, [join(repo, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", new URL(site).port], {
      cwd: webDirectory, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: provider.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: provider.publicKey, TAME_SITE_URL: site }, stdio: "ignore",
    });
    web.on("exit", () => { webExited = true; });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      check(!webExited, "OAuth integration web process exited.");
      try { if ((await fetch(`${site}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    check(ready, "Build the web app before running OAuth integration.");
    async function begin(targetResource = resource) {
      const verifier = randomBytes(32).toString("base64url"), state = randomBytes(24).toString("base64url");
      const url = new URL(`${provider.url}/auth/v1/oauth/authorize`);
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:4400/callback", scope: "openid", resource: targetResource, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
      const response = await fetch(url, { redirect: "manual" });
      check(response.status === 302, "Authorization initiation failed.");
      const destination = new URL(response.headers.get("location"));
      check(destination.origin === site, "Provider redirected outside the consent site.");
      return { id: destination.searchParams.get("authorization_id"), path: destination.pathname + destination.search, verifier, state };
    }
    async function decide(flow, decision = "approve") {
      const response = await endpoint(flow.path);
      check(response.status === 200, "Consent page did not load.");
      const html = await response.text();
      check(html.includes("TAME OAuth integration agent") && html.includes("Create and update your task profiles"), "Consent does not identify the app and its permissions.");
      check(!html.includes("authorization_code"), "Authorization code leaked into the consent page.");
      const data = hiddenFields(html);
      data.set("decision", decision);
      const result = await endpoint(flow.path, { method: "POST", headers: { Origin: site }, body: data });
      check(result.status === 303, "Consent action did not redirect.");
      const callback = new URL(result.headers.get("location"), site);
      check(callback.origin === "http://127.0.0.1:4400" && callback.searchParams.get("state") === flow.state, "Consent did not preserve the registered callback and state.");
      return callback;
    }
    async function exchange(flow, callback, overrides = {}) {
      const response = await fetch(`${provider.url}/auth/v1/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: provider.publicKey }, body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code"), client_id: clientId, redirect_uri: "http://127.0.0.1:4400/callback", code_verifier: flow.verifier, resource, ...overrides }) });
      return { ok: response.ok, data: await response.json() };
    }
    async function refresh(token) {
      const response = await fetch(`${provider.url}/auth/v1/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: provider.publicKey }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: clientId, resource }) });
      return { ok: response.ok, data: await response.json() };
    }
    const first = await begin();
    const login = await endpoint(first.path);
    check(login.status === 307 && new URL(login.headers.get("location"), site).searchParams.get("authorization_id") === first.id, "Login continuation was not preserved.");
    const loginPath = new URL(login.headers.get("location"), site);
    const credentials = hiddenFields(await (await endpoint(loginPath.pathname + loginPath.search)).text());
    credentials.set("email", email); credentials.set("password", password);
    const signedIn = await endpoint(loginPath.pathname + loginPath.search, { method: "POST", headers: { Origin: site }, body: credentials });
    check(signedIn.status === 303 && new URL(signedIn.headers.get("location"), site).searchParams.get("authorization_id") === first.id, "Sign-in did not return to consent.");
    const callback = await decide(first);
    const issued = await exchange(first, callback);
    check(issued.ok && issued.data.access_token && issued.data.refresh_token, "Authorization code exchange failed.");
    const claims = JSON.parse(Buffer.from(issued.data.access_token.split(".")[1], "base64url"));
    check(claims.aud === resource && claims.client_id === clientId && claims.sub === userId, "OAuth token is not bound to TAME and the verified account.");
    sdk = new Client({ name: "tame-oauth-integration", version: "1.0.0" });
    await sdk.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${issued.data.access_token}` } } }));
    const info = await sdk.callTool({ name: "get_connection_info", arguments: {} });
    check(info.structuredContent.ownerId === userId, "MCP returned another account.");
    const otherUser = await admin.auth.admin.createUser({ email: `tame-oauth-other-${randomUUID()}@example.invalid`, password: `Test-${randomUUID()}`, email_confirm: true });
    check(!otherUser.error && otherUser.data.user, "Second fixture account creation failed.");
    otherUserId = otherUser.data.user.id;
    const otherCollection = await admin.from("collections").insert({ owner_id: otherUserId, name: "Other private collection" }).select("id").single();
    check(!otherCollection.error && otherCollection.data, "Second fixture collection creation failed.");
    check(!(await admin.from("collections").insert(Array.from({ length: 21 }, (_, index) => ({ owner_id: userId, name: `Pagination ${index}` })))).error, "Collection pagination fixtures failed.");
    const documentId = randomUUID(), foreignDocumentId = randomUUID();
    const documents = Array.from({ length: 21 }, (_, index) => {
      const id = index === 0 ? documentId : randomUUID();
      return { id, owner_id: userId, collection_id: collection.data.id, name: `Example ${index}.md`, media_type: "text/markdown", size_bytes: 30, status: index === 0 ? "ready" : "uploading", storage_path: `${userId}/${id}/original` };
    });
    documents.push({ id: foreignDocumentId, owner_id: otherUserId, collection_id: otherCollection.data.id, name: "Foreign private example.md", media_type: "text/markdown", size_bytes: 6, status: "ready", storage_path: `${otherUserId}/${foreignDocumentId}/original` });
    check(!(await admin.from("documents").insert(documents)).error, "Document fixtures failed.");
    const sectionRows = Array.from({ length: 5 }, (_, ordinal) => ({ owner_id: userId, document_id: documentId, extraction_version: 1, ordinal, content: `Text ${ordinal}`, source_start: ordinal * 6, source_end: ordinal * 6 + 6 }));
    sectionRows.push({ owner_id: otherUserId, document_id: foreignDocumentId, extraction_version: 1, ordinal: 0, content: "secret", source_start: 0, source_end: 6 });
    check(!(await admin.from("document_sections").insert(sectionRows)).error, "Section fixtures failed.");
    const call = async (name, args = {}) => {
      const result = await sdk.callTool({ name, arguments: args });
      check(!result.isError, `Example tool ${name} failed.`);
      return result.structuredContent;
    };
    const firstCollections = await call("list_collections"), lastCollections = await call("list_collections", { page: firstCollections.nextPage });
    check(firstCollections.items.length === 20 && lastCollections.items.length === 2 && lastCollections.nextPage === null, "Collection pagination failed.");
    check(![...firstCollections.items, ...lastCollections.items].some(item => item.id === otherCollection.data.id), "Another account's collection leaked.");
    const firstDocuments = await call("list_documents", { collectionId: collection.data.id });
    const lastDocuments = await call("list_documents", { collectionId: collection.data.id, page: firstDocuments.nextPage });
    check(firstDocuments.items.length === 20 && lastDocuments.items.length === 1 && lastDocuments.nextPage === null, "Document pagination failed.");
    const firstRead = await call("read_document", { documentId });
    const lastRead = await call("read_document", { documentId, version: firstRead.extractionVersion, after: firstRead.nextAfter });
    check(JSON.stringify([...firstRead.sections, ...lastRead.sections].map(section => section.ordinal)) === "[0,1,2,3,4]" && lastRead.nextAfter === null, "Section pagination failed.");
    check(!JSON.stringify(firstRead).includes("owner_id") && !JSON.stringify(firstRead).includes("storage_path"), "Private storage metadata leaked.");
    async function expectToolError(name, args, code) {
      const result = await sdk.callTool({ name, arguments: args });
      check(result.isError && JSON.parse(result.content[0].text).error === code, `Expected ${code} from ${name}.`);
    }
    const guide = await call("get_profile_authoring_guide");
    check(guide.schemaVersion === 1 && guide.createDraftInput.properties.payload, "Authoring guide did not expose the profile contract.");
    const draftInput = {
      draftId: randomUUID(), payload: {
        schemaVersion: 1, name: "OAuth fixture narrative", description: "Private test proposal", purpose: "Explain observations before actions",
        usageConditions: { whenToUse: ["Narrative writeups"], whenNotToUse: ["Question-by-question submissions"] },
        rules: [{ id: "observations", category: "style", instruction: "Present observations before actions", strength: "preferred", origin: "inferred" }],
        evidence: [{ ruleId: "observations", documentId, sectionId: firstRead.sections[0].id, extractionVersion: 1, excerpt: "Text 0" }],
      }, preview: "Illustration: [observation], then [action]",
    };
    const draft = await call("create_profile_draft", draftInput);
    check(draft.status === "pending_review" && draft.draftHash.length === 64, "Draft was not saved as a reviewable proposal.");
    check(JSON.stringify(await call("create_profile_draft", draftInput)) === JSON.stringify(draft), "Draft retry was not idempotent.");
    check(JSON.stringify(await call("get_profile_draft", { draftId: draft.id })) === JSON.stringify(draft), "Stored draft could not be retrieved.");
    await expectToolError("create_profile_draft", { ...draftInput, payload: { ...draftInput.payload, name: "Changed" } }, "draft_conflict");
    const invalidDraft = structuredClone(draftInput);
    invalidDraft.draftId = randomUUID(); invalidDraft.payload.evidence[0].excerpt = "Fabricated excerpt";
    await expectToolError("create_profile_draft", invalidDraft, "invalid_evidence");
    const foreignDraft = randomUUID();
    check(!(await admin.from("profile_drafts").insert({ id: foreignDraft, owner_id: otherUserId, payload: draftInput.payload })).error, "Foreign draft fixture failed.");
    await expectToolError("get_profile_draft", { draftId: foreignDraft }, "not_found");
    const evidenceCount = await admin.from("profile_sources").select("id", { count: "exact", head: true }).eq("draft_id", draft.id);
    const publishedCount = await admin.from("profile_versions").select("id", { count: "exact", head: true }).eq("owner_id", userId);
    check(!evidenceCount.error && evidenceCount.count === 1 && !publishedCount.error && publishedCount.count === 0, "Draft sources or non-publication guarantees failed.");
    console.info("PASS profile authoring guide, draft creation/retrieval, evidence checks, idempotent retry and draft isolation");
    check((await call("find_profiles")).items.length === 0, "A pending draft appeared as an active profile.");
    const publication = { draftId: draft.id, draftHash: draft.draftHash, idempotencyKey: randomUUID(), approval: "user_requested" };
    const saved = await call("save_profile_version", publication);
    check(saved.profile.versionNumber === 1 && saved.profile.evidenceStatus[0].status === "available", "Publication did not produce a valid v1 snapshot.");
    check((await call("save_profile_version", publication)).profile.versionId === saved.profile.versionId, "Publication retry created a second version.");
    const matches = await call("find_profiles", { query: "OAUTH FIXTURE", page: 1 });
    check(matches.items.length === 1 && matches.items[0].id === saved.profile.id, "Active profile search failed.");
    check((await call("get_profile", { profileId: saved.profile.id })).versionId === saved.profile.versionId, "Active profile retrieval returned the wrong version.");
    const draftAfterPublication = await call("get_profile_draft", { draftId: draft.id });
    check(draftAfterPublication.status === "published", "Draft was not marked published.");
    const secondProposal = { ...draftInput, draftId: randomUUID() };
    const secondDraft = await call("create_profile_draft", secondProposal);
    await expectToolError("save_profile_version", { ...publication, draftId: secondDraft.id, draftHash: secondDraft.draftHash }, "idempotency_conflict");
    await expectToolError("save_profile_version", { ...publication, draftId: secondDraft.id, draftHash: "0".repeat(64), idempotencyKey: randomUUID() }, "draft_changed");
    const foreignProfileId = randomUUID(), foreignVersionId = randomUUID();
    check(!(await admin.from("profiles").insert({ id: foreignProfileId, owner_id: otherUserId, name: "Foreign profile" })).error, "Foreign profile fixture failed.");
    check(!(await admin.from("profile_versions").insert({ id: foreignVersionId, owner_id: otherUserId, profile_id: foreignProfileId, version_number: 1, payload: draftInput.payload, approval_channel: "chat", approved_by: otherUserId })).error, "Foreign version fixture failed.");
    check(!(await admin.from("profiles").update({ active_version_id: foreignVersionId }).eq("id", foreignProfileId)).error, "Foreign active version fixture failed.");
    await expectToolError("get_profile", { profileId: foreignProfileId }, "not_found");
    check(!(await admin.from("documents").update({ extraction_version: 2 }).eq("id", documentId).eq("owner_id", userId)).error, "Extraction change fixture failed.");
    await expectToolError("save_profile_version", { draftId: secondDraft.id, draftHash: secondDraft.draftHash, idempotencyKey: randomUUID(), approval: "user_requested" }, "invalid_evidence");
    check((await call("get_profile", { profileId: saved.profile.id })).evidenceStatus[0].status !== "available", "Changed source was not flagged on retrieval.");
    check(!(await admin.from("documents").update({ extraction_version: 1 }).eq("id", documentId).eq("owner_id", userId)).error, "Extraction fixture restore failed.");
    console.info("PASS profile v1 publication, active search/retrieval, retry safety, source revalidation and profile isolation");
    const revisionInput = {
      draftId: randomUUID(), profileId: saved.profile.id, baseVersionId: saved.profile.versionId,
      payload: { ...draftInput.payload, rules: [...draftInput.payload.rules, { id: "natural_transitions", category: "style", instruction: "Avoid repetitive transition phrases", strength: "preferred", origin: "user_stated" }] },
      preview: "Illustration: [reason connected to the next action]", reason: "Explicit permanent style preference",
    };
    const revision = await call("propose_profile_update", revisionInput);
    check(revision.baseVersionId === saved.profile.versionId && revision.changes.rulesAdded.includes("natural_transitions"), "Revision did not expose its concurrency base and change summary.");
    const competing = await call("propose_profile_update", { ...revisionInput, draftId: randomUUID(), reason: "Competing preference" });
    const v2 = await call("save_profile_version", { draftId: revision.id, draftHash: revision.draftHash, idempotencyKey: randomUUID(), approval: "user_requested" });
    check(v2.profile.id === saved.profile.id && v2.profile.versionNumber === 2, "Revision did not become v2 of the same profile.");
    await expectToolError("save_profile_version", { draftId: competing.id, draftHash: competing.draftHash, idempotencyKey: randomUUID(), approval: "user_requested" }, "version_conflict");
    const historical = await call("get_profile_version", { profileId: saved.profile.id, versionId: saved.profile.versionId });
    check(historical.payload.rules.length === 1, "The original v1 snapshot changed.");
    const rollbackInput = { profileId: saved.profile.id, targetVersionId: saved.profile.versionId, baseVersionId: v2.profile.versionId,
      reason: "Explicit request to restore v1 style", idempotencyKey: randomUUID(), approval: "user_requested" };
    const restored = await call("rollback_profile", rollbackInput);
    check(restored.profile.versionNumber === 3 && restored.profile.restoredFromVersionId === saved.profile.versionId, "Rollback did not create v3 from v1.");
    check((await call("rollback_profile", rollbackInput)).profile.versionId === restored.profile.versionId, "Rollback retry created another version.");
    const history = await call("list_profile_versions", { profileId: saved.profile.id });
    check(JSON.stringify(history.items.map(item => item.versionNumber)) === "[3,2,1]", "Version history is incomplete.");
    check((await call("get_profile", { profileId: saved.profile.id })).versionId === restored.profile.versionId, "Rollback did not activate the restored snapshot.");
    await expectToolError("get_profile_version", { profileId: foreignProfileId, versionId: saved.profile.versionId }, "not_found");
    console.info("PASS profile v2 revision, stale-base rejection, historical snapshots and idempotent rollback as v3");
    await expectToolError("list_documents", { collectionId: otherCollection.data.id }, "not_found");
    await expectToolError("read_document", { documentId: foreignDocumentId }, "not_found");
    await expectToolError("read_document", { documentId, version: 2 }, "extraction_changed");
    await expectToolError("read_document", { documentId: documents[1].id }, "extraction_not_ready");
    check(!(await admin.from("connection_grants").update({ permissions: ["read_profiles"] }).eq("id", info.structuredContent.connectionId).eq("owner_id", userId)).error, "Permission fixture update failed.");
    await expectToolError("list_collections", {}, "permission_denied");
    await expectToolError("list_documents", { collectionId: collection.data.id }, "permission_denied");
    await expectToolError("read_document", { documentId }, "permission_denied");
    await expectToolError("create_profile_draft", { ...draftInput, draftId: randomUUID() }, "permission_denied");
    await expectToolError("save_profile_version", publication, "permission_denied");
    check(!(await admin.from("connection_grants").update({ permissions: ["read_examples", "read_profiles", "write_profiles"] }).eq("id", info.structuredContent.connectionId).eq("owner_id", userId)).error, "Permission fixture restore failed.");
    console.info("PASS OAuth example tools, collection/document/section pagination, two-account isolation and live permission changes");
    for (const token of [webToken, issued.data.id_token]) {
      check(token, "Expected a web token and an ID token.");
      check((await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status === 401, "MCP accepted a token that was not an MCP access token.");
    }
    const direct = await fetch(`${provider.url}/rest/v1/collections?select=id`, { headers: { apikey: provider.publicKey, Authorization: `Bearer ${issued.data.access_token}` } });
    check([200, 401, 403].includes(direct.status), "Unexpected direct Data API response.");
    if (direct.ok) check((await direct.json()).length === 0, "An agent token bypassed MCP through the Data API.");
    const bypass = await fetch(`${provider.url}/rest/v1/rpc/resolve_mcp_connection`, { method: "POST", headers: { apikey: provider.publicKey, Authorization: `Bearer ${issued.data.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_owner_id: userId, p_client_id: clientId, p_session_id: claims.session_id }) });
    check([401, 403].includes(bypass.status), "An agent token invoked an internal backend RPC.");
    check(!(await exchange(first, callback)).ok, "An authorization code was replayed.");
    const renewed = await refresh(issued.data.refresh_token);
    check(renewed.ok && JSON.parse(Buffer.from(renewed.data.access_token.split(".")[1], "base64url")).aud === resource, "Refresh lost resource binding.");
    console.info("PASS SDK discovery, browser-form login/consent, PKCE, signed-token MCP call, Data API isolation, code replay and refresh");
    const invalidRedirect = new URL(`${provider.url}/auth/v1/oauth/authorize`);
    invalidRedirect.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://unregistered.example/callback", scope: "openid", resource, code_challenge: createHash("sha256").update("x".repeat(43)).digest("base64url"), code_challenge_method: "S256" });
    check((await fetch(invalidRedirect, { redirect: "manual" })).status === 400, "An unregistered redirect URI was accepted.");
    const wrongPkce = await begin();
    check(!(await exchange(wrongPkce, await decide(wrongPkce), { code_verifier: randomBytes(32).toString("base64url") })).ok, "Invalid PKCE proof was accepted.");
    const wrongResource = await begin("https://other.example/mcp");
    check((await (await endpoint(wrongResource.path)).text()).includes("Connection unavailable"), "Wrong-resource authorization reached consent.");
    const denied = await decide(await begin(), "deny");
    check(denied.searchParams.get("error") === "access_denied" && !denied.searchParams.has("code"), "Denied consent exposed a code.");
    console.info("PASS invalid PKCE, wrong resource and denial after provider auto-approval");
    const revoked = await owner.rpc("revoke_mcp_connection", { p_connection_id: info.structuredContent.connectionId });
    check(!revoked.error && revoked.data === true, "TAME revoke failed.");
    check((await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${issued.data.access_token}` } })).status === 401, "An unexpired JWT survived TAME revoke.");
    check(!(await refresh(renewed.data.refresh_token)).ok, "Refresh resurrected a revoked TAME connection.");
    const reconnect = await begin();
    const connected = await exchange(reconnect, await decide(reconnect));
    check(connected.ok && connected.data.access_token, "Fresh consent did not permit a new connection.");
    check((await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${issued.data.access_token}` } })).status === 401, "Fresh consent reactivated an old JWT.");
    check(!(await owner.auth.oauth.revokeGrant({ clientId })).error, "Provider revoke failed.");
    check((await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${connected.data.access_token}` } })).status === 401, "Provider revoke did not invalidate the existing JWT at MCP.");
    check(!(await refresh(connected.data.refresh_token)).ok, "Provider-revoked refresh token was accepted.");
    console.info("PASS TAME revoke, new consent, old-JWT rejection and provider revoke");
  } finally {
    if (sdk) await sdk.close().catch(() => {});
    if (web && !webExited) { web.kill("SIGTERM"); await once(web, "exit"); }
    if (mcpServer) { mcpServer.closeAllConnections(); await new Promise(resolve => mcpServer.close(resolve)); }
    let cleanupFailed = false;
    if (clientId) {
      try { cleanupFailed = Boolean((await admin.from("mcp_oauth_clients").delete().eq("client_id", clientId)).error); } catch { cleanupFailed = true; }
      try { cleanupFailed = Boolean((await admin.auth.admin.oauth.deleteClient(clientId)).error) || cleanupFailed; } catch { cleanupFailed = true; }
    }
    if (userId) { try { cleanupFailed = Boolean((await admin.auth.admin.deleteUser(userId)).error) || cleanupFailed; } catch { cleanupFailed = true; } }
    if (otherUserId) { try { cleanupFailed = Boolean((await admin.auth.admin.deleteUser(otherUserId)).error) || cleanupFailed; } catch { cleanupFailed = true; } }
    await provider.stop();
    check(!cleanupFailed, "OAuth fixture cleanup failed.");
    console.info("Temporary OAuth provider, client and account cleaned up. Main Auth configuration unchanged.");
  }
}
run().catch(error => { console.error(error instanceof Error ? error.message : "OAuth integration failed."); process.exitCode = 1; });
