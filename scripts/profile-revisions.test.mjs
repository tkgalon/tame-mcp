import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { processingDatabase, scenario, sqlError, uploadedDocument, alice, bob } from "./processing-test-helpers.mjs";
test("profile revisions use optimistic concurrency and rollback preserves history", { timeout: 90000 }, async (t) => {
    await processingDatabase(async ({ client, connection }) => {
        const clientId = randomUUID(), sessionId = randomUUID(), grantId = randomUUID();
        await client.query("insert into auth.oauth_clients (id) values ($1)", [clientId]);
        await client.query("insert into public.mcp_oauth_clients (client_id,resource_url) values ($1,'http://127.0.0.1:3001/mcp')", [clientId]);
        await client.query("insert into public.mcp_oauth_consents (owner_id,client_id) values ($1,$2)", [alice, clientId]);
        await client.query("insert into auth.sessions (id,user_id,oauth_client_id) values ($1,$2,$3)", [sessionId, alice, clientId]);
        await client.query("insert into public.connection_grants (id,owner_id,client_id,provider_session_id,permissions) values ($1,$2,$3,$4,array['read_profiles','write_profiles','read_examples'])", [grantId, alice, clientId, sessionId]);
        const documentId = await uploadedDocument(client, { status: "ready" }), sectionId = randomUUID();
        await client.query("insert into public.document_sections (id,owner_id,document_id,extraction_version,ordinal,content) values ($1,$2,$3,1,0,'Reason before command')", [sectionId, alice, documentId]);
        const payload = { schemaVersion: 1, name: "CTF", description: "Narrative", purpose: "Explain reasoning", usageConditions: { whenToUse: ["CTF"], whenNotToUse: [] },
            rules: [{ id: "reason", category: "style", instruction: "Explain the reason", strength: "preferred", origin: "inferred" }],
            evidence: [{ ruleId: "reason", documentId, sectionId, extractionVersion: 1, excerpt: "Reason before command" }] };
        const identity = [alice, clientId, sessionId];
        const saveSql = "select public.save_mcp_profile_version($1,$2,$3,$4,$5,$6,$7) result";
        const saveArgs = (draft, key = randomUUID()) => [...identity, draft.id, draft.draftHash, key, "user_requested"];
        const save = async (draft) => (await client.query(saveSql, saveArgs(draft))).rows[0].result.profile;
        const initialDraft = (await client.query("select public.create_mcp_profile_draft($1,$2,$3,$4,$5,'Illustration') result", [...identity, randomUUID(), payload])).rows[0].result;
        const v1 = await save(initialDraft);
        const proposeSql = "select public.propose_mcp_profile_update($1,$2,$3,$4,$5,$6,$7,$8,$9) result";
        const updated = (label = "More natural transitions") => ({ ...payload, rules: [...payload.rules, { id: "transitions", category: "style", instruction: label, strength: "preferred", origin: "user_stated" }] });
        const proposeArgs = (base = v1, value = updated(), id = randomUUID()) => [...identity, id, v1.id, base.versionId, value, "Illustration", "Explicit permanent preference"];
        const propose = async (base = v1, value = updated()) => (await client.query(proposeSql, proposeArgs(base, value))).rows[0].result;
        const rollbackSql = "select public.rollback_mcp_profile($1,$2,$3,$4,$5,$6,$7,$8,$9) result";
        const rollbackArgs = (base, target = v1, key = randomUUID()) => [...identity, v1.id, target.versionId, base.versionId, "Restore previous writing style", key, "user_requested"];
        const get = async () => (await client.query("select public.get_mcp_profile($1,$2,$3,$4) result", [...identity, v1.id])).rows[0].result;
        const history = async (before = null) => (await client.query("select public.list_mcp_profile_versions($1,$2,$3,$4,$5) result", [...identity, v1.id, before])).rows[0].result;
        await scenario(t, client, "update draft contains target, review hash and deterministic changes without activating", async () => {
            const args = proposeArgs(), proposal = (await client.query(proposeSql, args)).rows[0].result;
            assert.equal(proposal.profileId, v1.id);
            assert.equal(proposal.baseVersionId, v1.versionId);
            assert.deepEqual(proposal.changes.rulesAdded, ["transitions"]);
            assert.deepEqual(proposal.changes.rulesRemoved, []);
            assert.equal((await get()).versionId, v1.versionId);
            assert.deepEqual((await client.query(proposeSql, args)).rows[0].result, proposal);
            const changed = [...args];
            changed[8] = "Different reason";
            await sqlError(client, proposeSql, changed, "23505");
        });
        await scenario(t, client, "publication increments the same profile and old snapshots remain unchanged", async () => {
            const proposal = await propose(), v2 = await save(proposal);
            assert.equal(v2.id, v1.id);
            assert.equal(v2.versionNumber, 2);
            assert.equal((await get()).versionId, v2.versionId);
            const old = (await client.query("select public.get_mcp_profile_version($1,$2,$3,$4,$5) result", [...identity, v1.id, v1.versionId])).rows[0].result;
            assert.deepEqual(old.payload, payload);
            assert.equal((await history()).items.length, 2);
            const wrongBase = proposeArgs(v1, updated("Different"));
            await sqlError(client, proposeSql, wrongBase);
        });
        await scenario(t, client, "two drafts based on v1 cannot silently overwrite each other", async () => {
            const a = await propose(), b = await propose(v1, updated("Another preference"));
            const v2 = await save(a);
            await sqlError(client, saveSql, saveArgs(b));
            assert.equal((await get()).versionId, v2.versionId);
            assert.equal((await history()).items.length, 2);
        });
        await scenario(t, client, "rollback creates v3 from v1, records provenance and is retry safe", async () => {
            const v2 = await save(await propose()), args = rollbackArgs(v2);
            const result = (await client.query(rollbackSql, args)).rows[0].result;
            assert.equal(result.profile.versionNumber, 3);
            assert.equal(result.profile.restoredFromVersionId, v1.versionId);
            assert.deepEqual(result.profile.payload, payload);
            assert.deepEqual((await client.query(rollbackSql, args)).rows[0].result, result);
            const entries = (await history()).items;
            assert.deepEqual(entries.map(item => item.versionNumber), [3, 2, 1]);
            assert.equal(entries[0].changeReason, "Restore previous writing style");
            await sqlError(client, rollbackSql, rollbackArgs(v2));
        });
        await scenario(t, client, "no-op proposals are rejected and hashes bind revision metadata", async () => {
            await sqlError(client, proposeSql, proposeArgs(v1, payload));
            const proposal = await propose();
            await client.query("update public.profile_drafts set change_reason='Changed review reason' where id=$1", [proposal.id]);
            await sqlError(client, saveSql, saveArgs(proposal));
        });
        await scenario(t, client, "deleted sources prevent update and rollback without partial publication", async () => {
            const v2 = await save(await propose());
            await client.query("delete from public.documents where id=$1", [documentId]);
            await sqlError(client, rollbackSql, rollbackArgs(v2));
            assert.equal((await get()).versionId, v2.versionId);
            assert.equal((await history()).items.length, 2);
        });
        await scenario(t, client, "history pagination is bounded and descending", async () => {
            let base = v1;
            for (let i = 0; i < 22; i++)
                base = await save(await propose(base, updated(`Preference ${i}`)));
            const a = await history(), b = await history(a.nextBefore);
            assert.equal(a.items.length, 20);
            assert.equal(b.items.length, 3);
            assert.equal(b.nextBefore, null);
            assert.equal(new Set([...a.items, ...b.items].map(item => item.versionId)).size, 23);
        });
        await scenario(t, client, "foreign profiles and version mismatches return no history or snapshot", async () => {
            await sqlError(client, "select public.list_mcp_profile_versions($1,$2,$3,$4)", [...identity, randomUUID()], "P0002");
            const foreign = randomUUID();
            await client.query("insert into public.profiles(id,owner_id,name)values($1,$2,'Foreign')", [foreign, bob]);
            assert.equal((await client.query("select public.get_mcp_profile_version($1,$2,$3,$4,$5) result", [...identity, foreign, v1.versionId])).rows[0].result, null);
            await sqlError(client, rollbackSql, [...identity, v1.id, randomUUID(), v1.versionId, "Reason", randomUUID(), "user_requested"], "P0002");
        });
        await scenario(t, client, "revoked and read-only connections cannot revise profiles", async () => {
            await client.query("update public.connection_grants set permissions=array['read_profiles'] where id=$1", [grantId]);
            await sqlError(client, proposeSql, proposeArgs(), "42501");
            await sqlError(client, rollbackSql, rollbackArgs(v1), "42501");
            await client.query("update public.connection_grants set revoked_at=now() where id=$1", [grantId]);
            await sqlError(client, "select public.list_mcp_profile_versions($1,$2,$3,$4)", [...identity, v1.id], "42501");
        });
        for (const role of ["anon", "authenticated"])
            await scenario(t, client, `${role} cannot invoke revision RPCs directly`, async () => {
                await client.query(`set local role ${role}`);
                await sqlError(client, proposeSql, proposeArgs(), "42501");
                await sqlError(client, rollbackSql, rollbackArgs(v1), "42501");
                await sqlError(client, "select public.get_mcp_profile_version($1,$2,$3,$4,$5)", [...identity, v1.id, v1.versionId], "42501");
            });
        await t.test("concurrent publications based on the same version have exactly one winner", async () => {
            const a = await propose(), b = await propose(v1, updated("Competing preference")), second = new Client(connection);
            try {
                await second.connect();
                const results = await Promise.allSettled([client.query(saveSql, saveArgs(a)), second.query(saveSql, saveArgs(b))]);
                assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
                assert.equal(results.find(item => item.status === "rejected").reason.message, "version_conflict");
            }
            finally {
                await second.end();
            }
        });
        await t.test("concurrent rollbacks produce one restoration and one version conflict without deadlocks", async () => {
            const base = await get(), second = new Client(connection);
            try {
                await second.connect();
                const outcomes = await Promise.allSettled([client.query(rollbackSql, rollbackArgs(base)), second.query(rollbackSql, rollbackArgs(base))]);
                assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
                assert.equal(outcomes.find(item => item.status === "rejected").reason.message, "version_conflict");
                assert.equal((await get()).versionNumber, 3);
            }
            finally {
                await second.end();
            }
        });
    });
});
