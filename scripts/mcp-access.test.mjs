import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { processingDatabase, scenario, sqlError, alice, bob } from "./processing-test-helpers.mjs";

const clientId = "aaaaaaaa-1111-4111-8111-111111111111";
const otherClient = "bbbbbbbb-2222-4222-8222-222222222222";
const sessionId = "cccccccc-3333-4333-8333-333333333333";
const grantId = "dddddddd-4444-4444-8444-444444444444";
const resolve = async (client, owner = alice, oauthClient = clientId, session = sessionId) => (await client.query("select public.resolve_mcp_connection($1,$2,$3) as grant", [owner, oauthClient, session])).rows[0].grant;

test("MCP connections are bound to provider sessions and revocable before JWT expiry", { timeout: 90_000 }, async t => {
  await processingDatabase(async ({ client }) => {
    await client.query("insert into auth.oauth_clients (id) values ($1),($2)", [clientId, otherClient]);
    await client.query("insert into auth.sessions (id,user_id,oauth_client_id) values ($1,$2,$3)", [sessionId, alice, clientId]);
    await client.query("insert into public.connection_grants (id,owner_id,client_id,provider_session_id,permissions) values ($1,$2,$3,$4,array['read_examples','read_examples','read_profiles'])", [grantId, alice, clientId, sessionId]);
    await scenario(t, client, "backend resolves only the exact active owner/client/session tuple", async () => {
      await client.query("set local role service_role");
      assert.deepEqual(await resolve(client), { id: grantId, owner_id: alice, client_id: clientId, provider_session_id: sessionId, permissions: ["read_examples", "read_profiles"] });
      assert.equal(await resolve(client, bob), null);
      assert.equal(await resolve(client, alice, otherClient), null);
      assert.equal(await resolve(client, alice, clientId, randomUUID()), null);
    });
    for (const [name, statement, values] of [
      ["revoked grants", "update public.connection_grants set revoked_at=clock_timestamp() where id=$1", [grantId]],
      ["expired grants", "update public.connection_grants set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=$1", [grantId]],
      ["expired provider sessions", "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [sessionId]],
      ["deleted provider sessions", "delete from auth.sessions where id=$1", [sessionId]],
      ["a provider session for another owner", "update auth.sessions set user_id=$1 where id=$2", [bob, sessionId]],
      ["a provider session for another client", "update auth.sessions set oauth_client_id=$1 where id=$2", [otherClient, sessionId]],
      ["deleted OAuth clients", "update auth.oauth_clients set deleted_at=clock_timestamp() where id=$1", [clientId]],
      ["banned users", "update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [alice]],
    ]) await scenario(t, client, `${name} invalidate access immediately`, async () => {
      await client.query(statement, values);
      assert.equal(await resolve(client), null);
    });
    await scenario(t, client, "permission changes apply to the next lookup", async () => {
      await client.query("update public.connection_grants set permissions=array['read_profiles'] where id=$1", [grantId]);
      assert.deepEqual((await resolve(client)).permissions, ["read_profiles"]);
    });
    await scenario(t, client, "web owner can revoke idempotently without deleting evidence", async () => {
      await client.query("set local role authenticated");
      for (let attempt = 0; attempt < 2; attempt++) assert.equal((await client.query("select public.revoke_mcp_connection($1) as ok", [grantId])).rows[0].ok, true);
      await client.query("reset role");
      assert.equal(await resolve(client), null);
      assert.equal((await client.query("select * from public.connection_grants where id=$1", [grantId])).rowCount, 1);
    });
    await scenario(t, client, "other web accounts cannot revoke a connection", async () => {
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: bob })]);
      await client.query("set local role authenticated");
      assert.equal((await client.query("select public.revoke_mcp_connection($1) as ok", [grantId])).rows[0].ok, false);
      await client.query("reset role");
      assert.ok(await resolve(client));
    });
    await scenario(t, client, "OAuth tokens cannot revoke through the web RPC", async () => {
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: alice, client_id: clientId })]);
      await client.query("set local role authenticated");
      await sqlError(client, "select public.revoke_mcp_connection($1)", [grantId], "42501");
    });
    for (const role of ["anon", "authenticated"]) await scenario(t, client, `${role} cannot resolve connections via the Data API`, async () => {
      await client.query(`set local role ${role}`);
      await sqlError(client, "select public.resolve_mcp_connection($1,$2,$3)", [alice, clientId, sessionId], "42501");
    });
  });
});
