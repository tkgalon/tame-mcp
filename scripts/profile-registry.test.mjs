import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { processingDatabase, scenario, sqlError, uploadedDocument, alice, bob } from "./processing-test-helpers.mjs";

test("profile registry publishes reviewed drafts atomically and retrieves only owned active versions", { timeout: 90_000 }, async t => {
  await processingDatabase(async ({ client, connection }) => {
    const clientId = randomUUID(), sessionId = randomUUID(), grantId = randomUUID();
    await client.query("insert into auth.oauth_clients (id) values ($1)", [clientId]);
    await client.query("insert into public.mcp_oauth_clients (client_id,resource_url) values ($1,'http://127.0.0.1:3001/mcp')", [clientId]);
    await client.query("insert into public.mcp_oauth_consents (owner_id,client_id) values ($1,$2)", [alice, clientId]);
    await client.query("insert into auth.sessions (id,user_id,oauth_client_id) values ($1,$2,$3)", [sessionId, alice, clientId]);
    await client.query("insert into public.connection_grants (id,owner_id,client_id,provider_session_id,permissions) values ($1,$2,$3,$4,array['write_profiles','read_profiles','read_examples'])", [grantId, alice, clientId, sessionId]);
    const documentId = await uploadedDocument(client, { status: "ready" }), sectionId = randomUUID();
    await client.query("insert into public.document_sections (id,owner_id,document_id,extraction_version,ordinal,content) values ($1,$2,$3,1,0,'Observation before action')", [sectionId, alice, documentId]);
    const payload = { schemaVersion: 1, name: "CTF Narasi", description: "Narrative writeups", purpose: "Explain reasoning",
      usageConditions: { whenToUse: ["CTF narrative"], whenNotToUse: [] },
      rules: [{ id: "reason", category: "style", instruction: "Explain observations before actions", strength: "preferred", origin: "inferred" }],
      evidence: [{ ruleId: "reason", documentId, sectionId, extractionVersion: 1, excerpt: "Observation before action" }],
    };
    async function draft(value = payload) {
      return (await client.query("select public.create_mcp_profile_draft($1,$2,$3,$4,$5,'Illustration') as draft", [alice, clientId, sessionId, randomUUID(), value])).rows[0].draft;
    }
    const saveSql = "select public.save_mcp_profile_version($1,$2,$3,$4,$5,$6,$7) as result";
    const args = (value, key = randomUUID()) => [alice, clientId, sessionId, value.id, value.draftHash, key, "user_requested"];
    const save = async values => (await client.query(saveSql, values)).rows[0].result;
    const get = async id => (await client.query("select public.get_mcp_profile($1,$2,$3,$4) as result", [alice, clientId, sessionId, id])).rows[0].result;
    const find = async (query = "", page = 1) => (await client.query("select public.find_mcp_profiles($1,$2,$3,$4,$5) as result", [alice, clientId, sessionId, query, page])).rows[0].result;

    await scenario(t, client, "drafts remain invisible until publication creates v1, provenance and audit", async () => {
      await client.query("set local role service_role");
      const proposal = await draft();
      assert.deepEqual(await find(), { items: [], nextPage: null });
      const result = await save(args(proposal)), profile = result.profile;
      assert.equal(profile.versionNumber, 1);
      assert.equal(profile.approvalChannel, "chat");
      assert.deepEqual(profile.payload, payload);
      assert.equal(profile.evidenceStatus[0].status, "available");
      assert.deepEqual(await get(profile.id), profile);
      assert.equal((await find("nArAsI")).items[0].id, profile.id);
      assert.equal((await find("writeups")).items.length, 1);
      assert.equal((await client.query("select status,profile_id from public.profile_drafts where id=$1", [proposal.id])).rows[0].status, "published");
      assert.equal((await client.query("select count(*)::int n from public.profile_sources where version_id=$1", [profile.versionId])).rows[0].n, 1);
      assert.equal((await client.query("select count(*)::int n from public.audit_events where action='save_profile_version'")).rows[0].n, 1);
    });
    await scenario(t, client, "identical retries return the original version and a reused key cannot publish another draft", async () => {
      const a = await draft(), b = await draft(), values = args(a);
      const first = await save(values);
      assert.deepEqual(await save(values), first);
      await sqlError(client, saveSql, args(b, values[5]), "23505");
      await sqlError(client, saveSql, args(a), "22023");
      assert.equal((await client.query("select count(*)::int n from public.profile_versions")).rows[0].n, 1);
    });
    await scenario(t, client, "reviewed draft hash and explicit approval are required", async () => {
      const proposal = await draft(), values = args(proposal);
      values[4] = "0".repeat(64);
      await sqlError(client, saveSql, values);
      values[4] = proposal.draftHash; values[6] = null;
      await sqlError(client, saveSql, values);
      assert.deepEqual(await find(), { items: [], nextPage: null });
    });
    await scenario(t, client, "a draft changed after review cannot be published with the previous hash", async () => {
      const proposal = await draft();
      await client.query("update public.profile_drafts set preview='Changed illustration' where id=$1", [proposal.id]);
      await sqlError(client, saveSql, args(proposal));
      assert.equal((await client.query("select count(*)::int n from public.profile_versions")).rows[0].n, 0);
    });
    for (const [name, statement] of [
      ["changed extraction", "update public.documents set extraction_version=2 where id=$1"],
      ["failed extraction", "update public.documents set status='failed' where id=$1"],
      ["deleted source", "delete from public.documents where id=$1"],
      ["changed excerpt", "update public.document_sections set content='Different' where document_id=$1"],
    ]) await scenario(t, client, `${name} after review prevents publication with no partial writes`, async () => {
      const proposal = await draft();
      await client.query(statement, [documentId]);
      await sqlError(client, saveSql, args(proposal));
      assert.equal((await client.query("select count(*)::int n from public.profiles")).rows[0].n, 0);
      assert.equal((await client.query("select count(*)::int n from public.profile_mutations")).rows[0].n, 0);
      assert.equal((await client.query("select status from public.profile_drafts where id=$1", [proposal.id])).rows[0].status, "pending_review");
    });
    await scenario(t, client, "active profiles retain historical evidence and flag sources deleted after publication", async () => {
      const result = await save(args(await draft()));
      await client.query("delete from public.documents where id=$1", [documentId]);
      const profile = await get(result.profile.id);
      assert.deepEqual(profile.payload, payload);
      assert.equal(profile.evidenceStatus[0].status, "unavailable");
    });
    await scenario(t, client, "foreign and archived profiles are excluded and wildcard characters are literal", async () => {
      const result = await save(args(await draft()));
      assert.equal((await find("%")).items.length, 0);
      assert.equal((await find("_")).items.length, 0);
      assert.equal(await get(randomUUID()), null);
      const foreign = randomUUID();
      await client.query("insert into public.profiles (id,owner_id,name) values ($1,$2,'Foreign')", [foreign, bob]);
      await client.query("insert into public.profile_versions (owner_id,profile_id,version_number,payload,approval_channel,approved_by) values ($1,$2,1,$3,'chat',$1)", [bob, foreign, payload]);
      await client.query("update public.profiles set active_version_id=(select id from public.profile_versions where profile_id=$1) where id=$1", [foreign]);
      assert.equal(await get(foreign), null);
      assert.equal((await find()).items.length, 1);
      await client.query("update public.profiles set archived_at=now() where id=$1", [result.profile.id]);
      assert.equal(await get(result.profile.id), null);
      assert.equal((await find()).items.length, 0);
    });
    await scenario(t, client, "pagination returns 20 plus remaining items without duplicate identities", async () => {
      for (let index = 0; index < 22; index++) await save(args(await draft({ ...payload, name: `Profile ${String(index).padStart(2, '0')}` })));
      const a = await find(), b = await find("", a.nextPage);
      assert.equal(a.items.length, 20); assert.equal(a.nextPage, 2);
      assert.equal(b.items.length, 2); assert.equal(b.nextPage, null);
      assert.equal(new Set([...a.items, ...b.items].map(item => item.id)).size, 22);
    });
    for (const permissions of [["read_profiles"], ["write_profiles"], ["write_profiles", "read_profiles"]]) await scenario(t, client, `publication enforces all required permissions: ${permissions.join(',')}`, async () => {
      const proposal = await draft();
      await client.query("update public.connection_grants set permissions=$1 where id=$2", [permissions, grantId]);
      await sqlError(client, saveSql, args(proposal), "42501");
    });
    await scenario(t, client, "explicit preferences without evidence can be published without read_examples", async () => {
      const value = structuredClone(payload); value.rules[0].origin = "user_stated"; value.evidence = [];
      const proposal = await draft(value);
      await client.query("update public.connection_grants set permissions=array['read_profiles','write_profiles'] where id=$1", [grantId]);
      const published = await save(args(proposal));
      assert.deepEqual(published.profile.evidenceStatus, []);
    });
    await scenario(t, client, "revoked connections cannot publish or retrieve active profiles", async () => {
      const proposal = await draft();
      await client.query("update public.connection_grants set revoked_at=now() where id=$1", [grantId]);
      await sqlError(client, saveSql, args(proposal), "42501");
      await sqlError(client, "select public.find_mcp_profiles($1,$2,$3)", [alice, clientId, sessionId], "42501");
    });
    await scenario(t, client, "unknown and foreign drafts do not publish", async () => {
      const proposal = await draft();
      const foreignId = randomUUID();
      await client.query("insert into public.profile_drafts (id,owner_id,payload) values ($1,$2,$3)", [foreignId, bob, payload]);
      await sqlError(client, saveSql, [alice, clientId, sessionId, foreignId, proposal.draftHash, randomUUID(), "user_requested"], "P0002");
      await sqlError(client, saveSql, [alice, clientId, sessionId, randomUUID(), proposal.draftHash, randomUUID(), "user_requested"], "P0002");
    });
    for (const role of ["anon", "authenticated"]) await scenario(t, client, `${role} cannot invoke registry RPCs directly`, async () => {
      const values = args(await draft());
      await client.query(`set local role ${role}`);
      await sqlError(client, saveSql, values, "42501");
      await sqlError(client, "select public.find_mcp_profiles($1,$2,$3)", [alice, clientId, sessionId], "42501");
      await sqlError(client, "select public.get_mcp_profile($1,$2,$3,$4)", [alice, clientId, sessionId, randomUUID()], "42501");
    });
    await t.test("concurrent retry requests publish one version only", async () => {
      const second = new Client(connection);
      try {
        await second.connect();
        const values = args(await draft());
        const [a, b] = await Promise.all([client.query(saveSql, values), second.query(saveSql, values)]);
        assert.equal(a.rows[0].result.profile.versionId, b.rows[0].result.profile.versionId);
        assert.equal((await client.query("select count(*)::int n from public.profile_versions")).rows[0].n, 1);
      } finally { await second.end(); }
    });
    await t.test("different concurrent retry keys cannot publish the same draft twice", async () => {
      const second = new Client(connection);
      try {
        await second.connect();
        const proposal = await draft();
        const outcomes = await Promise.allSettled([client.query(saveSql, args(proposal)), second.query(saveSql, args(proposal))]);
        assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
        assert.equal(outcomes.find(outcome => outcome.status === "rejected").reason.code, "22023");
        assert.equal((await client.query("select count(*)::int n from public.profile_versions")).rows[0].n, 2);
      } finally { await second.end(); }
    });
  });
});
