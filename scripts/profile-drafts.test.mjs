import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { processingDatabase, scenario, sqlError, uploadedDocument, alice, bob, bobCollection } from "./processing-test-helpers.mjs";

test("profile draft operations preserve evidence, account isolation and retry safety", { timeout: 90_000 }, async t => {
  await processingDatabase(async ({ client, connection }) => {
    const clientId = randomUUID(), sessionId = randomUUID(), grantId = randomUUID();
    await client.query("insert into auth.oauth_clients (id) values ($1)", [clientId]);
    await client.query("insert into public.mcp_oauth_clients (client_id,resource_url) values ($1,'http://127.0.0.1:3001/mcp')", [clientId]);
    await client.query("insert into public.mcp_oauth_consents (owner_id,client_id) values ($1,$2)", [alice, clientId]);
    await client.query("insert into auth.sessions (id,user_id,oauth_client_id) values ($1,$2,$3)", [sessionId, alice, clientId]);
    await client.query("insert into public.connection_grants (id,owner_id,client_id,provider_session_id,permissions) values ($1,$2,$3,$4,array['write_profiles','read_profiles','read_examples'])", [grantId, alice, clientId, sessionId]);
    const documentId = await uploadedDocument(client, { status: "ready" });
    const foreignDocument = await uploadedDocument(client, { owner: bob, collection: bobCollection, status: "ready" });
    const sectionId = randomUUID(), foreignSection = randomUUID();
    await client.query("insert into public.document_sections (id,owner_id,document_id,extraction_version,ordinal,content) values ($1,$2,$3,1,0,'Explain why before the command'),($4,$5,$6,1,0,'Private example')", [sectionId, alice, documentId, foreignSection, bob, foreignDocument]);
    const payload = {
      schemaVersion: 1, name: "CTF Narasi", description: "Narrative writeups", purpose: "Explain the reasoning",
      usageConditions: { whenToUse: ["Narrative"], whenNotToUse: [] },
      rules: [{ id: "reason_first", category: "style", instruction: "Explain why before commands", strength: "preferred", origin: "inferred" }],
      evidence: [{ ruleId: "reason_first", documentId, sectionId, extractionVersion: 1, excerpt: "why before the command" }],
    };
    const statement = "select public.create_mcp_profile_draft($1,$2,$3,$4,$5,$6) as draft";
    const args = (id = randomUUID(), value = payload) => [alice, clientId, sessionId, id, value, "Illustration: [reason] then [command]"];
    const create = async values => (await client.query(statement, values)).rows[0].draft;
    const get = async id => (await client.query("select public.get_mcp_profile_draft($1,$2,$3,$4) as draft", [alice, clientId, sessionId, id])).rows[0].draft;

    await scenario(t, client, "creating a draft atomically stores evidence and one audit event without publishing", async () => {
      await client.query("set local role service_role");
      const values = args();
      const draft = await create(values);
      assert.equal(draft.status, "pending_review");
      assert.equal(draft.schemaVersion, 1);
      assert.match(draft.draftHash, /^[a-f0-9]{64}$/);
      assert.deepEqual(draft.payload, payload);
      assert.deepEqual(await get(draft.id), draft);
      assert.equal((await client.query("select count(*)::int as n from public.profile_sources where draft_id=$1", [draft.id])).rows[0].n, 1);
      assert.equal((await client.query("select count(*)::int as n from public.audit_events where target_id=$1", [draft.id])).rows[0].n, 1);
      assert.equal((await client.query("select count(*)::int as n from public.profile_versions")).rows[0].n, 0);
      assert.equal((await client.query("select count(*)::int as n from public.profiles")).rows[0].n, 0);
    });
    await scenario(t, client, "identical retries are idempotent and changed content cannot replace a proposal", async () => {
      const values = args();
      const first = await create(values);
      assert.deepEqual(await create(values), first);
      assert.equal((await client.query("select count(*)::int as n from public.audit_events where target_id=$1", [first.id])).rows[0].n, 1);
      await sqlError(client, statement, [...values.slice(0, 4), { ...payload, name: "Changed" }, values[5]], "23505");
      assert.deepEqual(await get(first.id), first);
    });
    for (const [name, mutate] of [
      ["foreign document", evidence => { evidence.documentId = foreignDocument; evidence.sectionId = foreignSection; evidence.excerpt = "Private example"; }],
      ["foreign section", evidence => evidence.sectionId = foreignSection],
      ["missing document", evidence => evidence.documentId = randomUUID()],
      ["stale extraction", evidence => evidence.extractionVersion = 2],
      ["fabricated quote", evidence => evidence.excerpt = "Invented evidence"],
      ["unknown rule", evidence => evidence.ruleId = "unknown"],
    ]) await scenario(t, client, `${name} rejects the entire draft without partial data`, async () => {
      const value = structuredClone(payload); mutate(value.evidence[0]);
      const values = args(randomUUID(), value);
      await sqlError(client, statement, values);
      assert.equal(await get(values[3]), null);
      assert.equal((await client.query("select count(*)::int as n from public.profile_sources")).rows[0].n, 0);
    });
    await scenario(t, client, "an inferred rule without evidence cannot be stored", async () => {
      await sqlError(client, statement, args(randomUUID(), { ...payload, evidence: [] }));
    });
    await scenario(t, client, "non-ready source documents are rejected", async () => {
      await client.query("update public.documents set status='failed' where id=$1", [documentId]);
      await sqlError(client, statement, args());
    });
    for (const permission of ["read_profiles", "write_profiles"]) await scenario(t, client, `${permission} alone cannot create a draft with example evidence`, async () => {
      await client.query("update public.connection_grants set permissions=array[$1] where id=$2", [permission, grantId]);
      await sqlError(client, statement, args(), "42501");
    });
    await scenario(t, client, "write access without example access can store explicit preferences without evidence", async () => {
      await client.query("update public.connection_grants set permissions=array['write_profiles'] where id=$1", [grantId]);
      const value = structuredClone(payload); value.rules[0].origin = "user_stated"; value.evidence = [];
      const draft = await create(args(randomUUID(), value));
      await sqlError(client, "select public.get_mcp_profile_draft($1,$2,$3,$4)", [alice, clientId, sessionId, draft.id], "42501");
    });
    await scenario(t, client, "revoked grants cannot create or read drafts", async () => {
      await client.query("update public.connection_grants set revoked_at=clock_timestamp() where id=$1", [grantId]);
      await sqlError(client, statement, args(), "42501");
      await sqlError(client, "select public.get_mcp_profile_draft($1,$2,$3,$4)", [alice, clientId, sessionId, randomUUID()], "42501");
    });
    await scenario(t, client, "draft IDs cannot expose or overwrite another owner's proposals", async () => {
      const id = randomUUID();
      await client.query("insert into public.profile_drafts (id,owner_id,payload) values ($1,$2,$3)", [id, bob, payload]);
      assert.equal(await get(id), null);
      await sqlError(client, statement, args(id), "23505");
    });
    for (const role of ["anon", "authenticated"]) await scenario(t, client, `${role} cannot bypass MCP with direct draft RPC calls`, async () => {
      await client.query(`set local role ${role}`);
      await sqlError(client, statement, args(), "42501");
      await sqlError(client, "select public.get_mcp_profile_draft($1,$2,$3,$4)", [alice, clientId, sessionId, randomUUID()], "42501");
    });
    await t.test("simultaneous retries create one draft and one audit event", async () => {
      const second = new Client(connection);
      try {
        await second.connect();
        const values = args();
        const [a, b] = await Promise.all([client.query(statement, values), second.query(statement, values)]);
        assert.deepEqual(a.rows[0].draft, b.rows[0].draft);
        assert.equal((await client.query("select count(*)::int as n from public.audit_events where target_id=$1", [values[3]])).rows[0].n, 1);
      } finally { await second.end(); }
    });
  });
});
