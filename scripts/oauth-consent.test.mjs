import assert from "node:assert/strict";
import test from "node:test";
import { processingDatabase, scenario, sqlError, alice, bob } from "./processing-test-helpers.mjs";
const clientId = "aaaaaaaa-1111-4111-8111-111111111111";
const sessionId = "bbbbbbbb-2222-4222-8222-222222222222";
const authorizationId = "A".repeat(32);
const resource = "http://127.0.0.1:3001/mcp";
const event = { user_id: alice, claims: { sub: alice, role: "authenticated", aud: "authenticated", client_id: clientId, session_id: sessionId, iat: 100, exp: 1000 } };
const hook = async (client, input = event) => (await client.query("select public.mcp_access_token_hook($1) as result", [input])).rows[0].result;
async function approve(client) {
  await client.query("update auth.oauth_authorizations set user_id=$1,status='approved',authorization_code='private-test-code' where authorization_id=$2", [alice, authorizationId]);
  await client.query("select public.approve_mcp_oauth_consent($1)", [authorizationId]);
}
test("OAuth consent and custom token hook", { timeout: 90000 }, async t => {
  await processingDatabase(async ({ client }) => {
    await client.query("insert into auth.oauth_clients (id,client_name) values ($1,'Test agent')", [clientId]);
    await client.query("insert into public.mcp_oauth_clients (client_id,resource_url) values ($1,$2)", [clientId, resource]);
    await client.query("insert into auth.sessions (id,user_id,oauth_client_id) values ($1,$2,$3)", [sessionId, alice, clientId]);
    await client.query("insert into auth.oauth_authorizations (authorization_id,client_id,redirect_uri,resource,code_challenge_method) values ($1,$2,'http://127.0.0.1:4400/callback',$3,'s256')", [authorizationId, clientId, resource]);
    await scenario(t, client, "pending authorizations expose registered context but no authorization code", async () => {
      await client.query("set local role authenticated");
      const context = (await client.query("select public.get_mcp_oauth_authorization($1) as context", [authorizationId])).rows[0].context;
      assert.equal(context.client_id, clientId);
      assert.equal(context.authorization_code, null);
      await sqlError(client, "select public.approve_mcp_oauth_consent($1)", [authorizationId], "42501");
    });
    await scenario(t, client, "provider approval and a web identity are required to store consent", async () => {
      await approve(client);
      assert.equal((await client.query("select owner_id from public.mcp_oauth_consents")).rows[0].owner_id, alice);
    });
    for (const [name, update, values] of [
      ["foreign user", "update auth.oauth_authorizations set user_id=$1", [bob]],
      ["wrong resource", "update auth.oauth_authorizations set resource='https://other.example/mcp'", []],
      ["plain PKCE", "update auth.oauth_authorizations set code_challenge_method='plain'", []],
      ["expired request", "update auth.oauth_authorizations set expires_at=clock_timestamp()-interval '1 second'", []],
    ]) await scenario(t, client, `${name} cannot authorize TAME access`, async () => {
      await client.query(update, values);
      await sqlError(client, "select public.get_mcp_oauth_authorization($1)", [authorizationId], "P0002");
    });
    await scenario(t, client, "web tokens keep their original audience and other claims", async () => {
      const input = { ...event, claims: { sub: alice, aud: "authenticated", role: "authenticated", custom: "preserved" } };
      assert.deepEqual(await hook(client, input), { claims: input.claims });
    });
    await scenario(t, client, "the Auth hook binds audience and creates exactly one session grant", async () => {
      await approve(client);
      await client.query("set local role supabase_auth_admin");
      for (let attempt = 0; attempt < 2; attempt++) assert.equal((await hook(client)).claims.aud, resource);
      await client.query("reset role");
      const grants = (await client.query("select owner_id,client_id,provider_session_id,permissions from public.connection_grants")).rows;
      assert.deepEqual(grants, [{ owner_id: alice, client_id: clientId, provider_session_id: sessionId, permissions: ["read_examples", "read_profiles", "write_profiles"] }]);
    });
    await scenario(t, client, "missing consent cannot mint a TAME token", async () => {
      await sqlError(client, "select public.mcp_access_token_hook($1)", [event], "42501");
      assert.equal((await client.query("select * from public.connection_grants")).rowCount, 0);
    });
    await scenario(t, client, "a provider session for another account cannot mint a grant", async () => {
      await approve(client);
      await client.query("update auth.sessions set user_id=$1 where id=$2", [bob, sessionId]);
      await sqlError(client, "select public.mcp_access_token_hook($1)", [event], "42501");
    });
    await scenario(t, client, "revocation blocks existing JWTs, refresh and newly issued sessions until consent is renewed", async () => {
      await approve(client);
      await hook(client);
      const grantId = (await client.query("select id from public.connection_grants")).rows[0].id;
      await client.query("select public.revoke_mcp_connection($1)", [grantId]);
      assert.equal((await client.query("select public.resolve_mcp_connection($1,$2,$3) as grant", [alice, clientId, sessionId])).rows[0].grant, null);
      await sqlError(client, "select public.mcp_access_token_hook($1)", [event], "42501");
      await approve(client);
      await sqlError(client, "select public.mcp_access_token_hook($1)", [event], "42501");
    });
    await scenario(t, client, "registered resource identities are immutable", async () => {
      await sqlError(client, "update public.mcp_oauth_clients set resource_url='https://other.example/mcp' where client_id=$1", [clientId], "55000");
    });
    for (const role of ["anon", "authenticated", "service_role"]) await scenario(t, client, `${role} cannot invoke the token hook directly`, async () => {
      await client.query(`set local role ${role}`);
      await sqlError(client, "select public.mcp_access_token_hook($1)", [event], "42501");
    });
  });
});
