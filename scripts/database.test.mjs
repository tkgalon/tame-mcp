import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { temporaryPostgres } from "./temporary-postgres.mjs";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceCollection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobCollection = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const aliceDocument = "11111111-aaaa-4111-8111-111111111111";
const bobDocument = "22222222-bbbb-4222-8222-222222222222";
const uploadDocument = "33333333-cccc-4333-8333-333333333333";
const aliceProfile = "11111111-dddd-4111-8111-111111111111";
const bobProfile = "22222222-dddd-4222-8222-222222222222";
const aliceVersion = "11111111-eeee-4111-8111-111111111111";
const bobVersion = "22222222-eeee-4222-8222-222222222222";
const aliceDraft = "11111111-ffff-4111-8111-111111111111";
const aliceSection = "11111111-abcd-4111-8111-111111111111";
const bobSection = "22222222-abcd-4222-8222-222222222222";
const alicePath = `${alice}/${aliceDocument}/original`;
const uploadPath = `${alice}/${uploadDocument}/original`;
const bobPath = `${bob}/${bobDocument}/original`;

test("database migrations and access boundaries", { timeout: 90_000 }, async t => {
  const cluster = await temporaryPostgres();
  const client = new Client(cluster.connection);
  try {
    await client.connect();
    await client.query(await readFile(new URL("./database-fixture.sql", import.meta.url), "utf8"));
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
      await client.query(await readFile(new URL(name, migrations), "utf8"));
    }
    await client.query(`
      insert into auth.users values ('${alice}'), ('${bob}');
      insert into public.collections (id, owner_id, name) values
        ('${aliceCollection}', '${alice}', 'Alice examples'),
        ('${bobCollection}', '${bob}', 'Bob examples');
      insert into public.documents (id, owner_id, collection_id, name, media_type, size_bytes, storage_path, status) values
        ('${aliceDocument}', '${alice}', '${aliceCollection}', 'alice.md', 'text/markdown', 100, '${alicePath}', 'ready'),
        ('${bobDocument}', '${bob}', '${bobCollection}', 'bob.md', 'text/markdown', 100, '${bobPath}', 'ready'),
        ('${uploadDocument}', '${alice}', '${aliceCollection}', 'upload.md', 'text/markdown', 100, '${uploadPath}', 'uploading');
      insert into public.document_sections (id, owner_id, document_id, extraction_version, ordinal, content) values
        ('${aliceSection}', '${alice}', '${aliceDocument}', 1, 0, 'Alice excerpt'),
        ('${bobSection}', '${bob}', '${bobDocument}', 1, 0, 'Bob excerpt');
      insert into public.profiles (id, owner_id, name) values
        ('${aliceProfile}', '${alice}', 'CTF narrative'), ('${bobProfile}', '${bob}', 'CTF Q&A');
      insert into public.profile_versions (id, owner_id, profile_id, version_number, payload, approval_channel, approved_by) values
        ('${aliceVersion}', '${alice}', '${aliceProfile}', 1, '{"purpose":"narrative"}', 'chat', '${alice}'),
        ('${bobVersion}', '${bob}', '${bobProfile}', 1, '{"purpose":"qa"}', 'chat', '${bob}');
      update public.profiles set active_version_id = '${aliceVersion}' where id = '${aliceProfile}';
      update public.profiles set active_version_id = '${bobVersion}' where id = '${bobProfile}';
      insert into public.profile_drafts (id, owner_id, profile_id, base_version_id, payload)
        values ('${aliceDraft}', '${alice}', '${aliceProfile}', '${aliceVersion}', '{"purpose":"updated"}');
      insert into public.profile_sources (owner_id, draft_id, rule_id, document_id, section_id, extraction_version, excerpt)
        values ('${alice}', '${aliceDraft}', 'style', '${aliceDocument}', '${aliceSection}', 1, 'Alice excerpt');
      insert into storage.objects (bucket_id, name) values ('documents', '${alicePath}'), ('documents', '${bobPath}');
    `);

    async function scenario(name, role, claims, body) {
      await t.test(name, async () => {
        await client.query("begin");
        try {
          assert.ok(["authenticated", "anon", "service_role", null].includes(role));
          if (role) await client.query(`set local role ${role}`);
          await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
          await body();
        } finally {
          await client.query("rollback");
        }
      });
    }
    const web = { sub: alice, role: "authenticated" };
    const oauth = { ...web, client_id: "codex-client" };
    const rejects = (query, code, params) => assert.rejects(client.query(query, params), error => error.code === code);

    await scenario("all application tables enable RLS", null, {}, async () => {
      const { rows } = await client.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
      assert.equal(rows.length, 11);
      assert.ok(rows.every(row => row.relrowsecurity));
    });
    await scenario("web session sees only its own rows", "authenticated", web, async () => {
      assert.equal((await client.query("select * from public.collections")).rowCount, 1);
      assert.equal((await client.query("select * from public.documents")).rowCount, 2);
      assert.equal((await client.query("select * from public.profile_versions")).rowCount, 1);
      assert.equal((await client.query("select * from public.profile_sources")).rowCount, 1);
      assert.equal((await client.query("select * from public.profiles where id=$1", [bobProfile])).rowCount, 0);
    });
    await scenario("second user cannot read the first user's documents", "authenticated", { sub: bob }, async () => {
      const { rows } = await client.query("select owner_id from public.documents");
      assert.deepEqual(rows, [{ owner_id: bob }]);
    });
    await scenario("anonymous reads are denied", "anon", {}, () => rejects("select * from public.collections", "42501"));
    await scenario("collection creation and rename work for owner", "authenticated", web, async () => {
      const { rows } = await client.query("insert into public.collections (name) values ('new') returning id");
      assert.equal((await client.query("update public.collections set name='renamed' where id=$1", [rows[0].id])).rowCount, 1);
      assert.equal((await client.query("update public.collections set name='stolen' where id=$1", [bobCollection])).rowCount, 0);
    });
    await scenario("cannot create a collection for another user", "authenticated", web, () => rejects("insert into public.collections (owner_id,name) values ($1,'stolen')", "42501", [bob]));
    await scenario("owner ID cannot be reassigned", "authenticated", web, () => rejects("update public.collections set owner_id=$1 where id=$2", "42501", [bob, aliceCollection]));
    await scenario("client cannot manufacture a ready document", "authenticated", web, () => rejects("insert into public.documents (name) values ('forged')", "42501"));
    await scenario("client cannot publish a version directly", "authenticated", web, () => rejects("insert into public.profile_versions (version_number) values (2)", "42501"));
    await scenario("client cannot edit or revoke grants directly", "authenticated", web, () => rejects("update public.connection_grants set permissions=array['write_profiles']", "42501"));
    await scenario("client cannot access jobs", "authenticated", web, () => rejects("select * from public.processing_jobs", "42501"));
    await scenario("OAuth token cannot bypass MCP via Data API", "authenticated", oauth, async () => {
      for (const table of ["collections", "documents", "document_sections", "profiles", "profile_versions", "profile_drafts", "profile_sources", "connection_grants", "audit_events"]) {
        assert.equal((await client.query(`select * from public.${table}`)).rowCount, 0, table);
      }
    });
    await scenario("OAuth token cannot create a collection directly", "authenticated", oauth, () => rejects("insert into public.collections (name) values ('bypass')", "42501"));
    await scenario("null client ID does not turn OAuth token into web session", "authenticated", { ...web, client_id: null }, async () => {
      assert.equal((await client.query("select * from public.collections")).rowCount, 0);
    });
    await scenario("cross-owner foreign keys hold even for backend", "service_role", {}, () => rejects(`insert into public.documents (id,owner_id,collection_id,name,media_type,size_bytes,storage_path) values ('00000000-0000-4000-8000-000000000000','${bob}','${aliceCollection}','bad','text/plain',1,'${bob}/00000000-0000-4000-8000-000000000000/original')`, "23503"));
    await scenario("active version must belong to the same profile and owner", "service_role", {}, async () => {
      await client.query("update public.profiles set active_version_id=$1 where id=$2", [bobVersion, aliceProfile]);
      await rejects("set constraints profiles_active_version_fk immediate", "23503");
    });
    await scenario("published snapshots cannot be overwritten even by backend", "service_role", {}, () => rejects("update public.profile_versions set payload='{\"changed\":true}' where id=$1", "55000", [aliceVersion]));
    await scenario("duplicate version numbers are rejected", "service_role", {}, () => rejects(`insert into public.profile_versions (owner_id,profile_id,version_number,payload,approval_channel,approved_by) values ('${alice}','${aliceProfile}',1,'{"purpose":"duplicate"}','chat','${alice}')`, "23505"));
    await scenario("oversized uploads are rejected", "service_role", {}, () => rejects("update public.documents set size_bytes=10485761 where id=$1", "23514", [aliceDocument]));
    await scenario("document storage path must match document identity", "service_role", {}, () => rejects("update public.documents set storage_path='other/original' where id=$1", "23514", [aliceDocument]));
    await scenario("unknown grant permissions are rejected", "service_role", {}, () => rejects(`insert into public.connection_grants (owner_id,client_id,provider_session_id,permissions) values ('${alice}','client','session',array['admin'])`, "23514"));
    await scenario("running job requires lease and token", "service_role", {}, () => rejects(`insert into public.processing_jobs (owner_id,document_id,parser_version,content_hash,status) values ('${alice}','${aliceDocument}','v1',repeat('a',64),'running')`, "23514"));
    await scenario("duplicate parsing jobs are rejected", "service_role", {}, async () => {
      const query=`insert into public.processing_jobs (owner_id,document_id,parser_version,content_hash) values ('${alice}','${aliceDocument}','v1',repeat('a',64))`;
      await client.query(query);
      await rejects(query, "23505");
    });
    await scenario("mutation keys are unique per owner", "service_role", {}, async () => {
      const query=`insert into public.profile_mutations (owner_id,idempotency_key,request_hash,draft_hash,resulting_version_id) values ('${alice}','request-1',repeat('a',64),repeat('b',64),'${aliceVersion}')`;
      await client.query(query);
      await rejects(query, "23505");
    });
    await scenario("web storage reads are owner-scoped", "authenticated", web, async () => {
      assert.deepEqual((await client.query("select name from storage.objects")).rows, [{ name: alicePath }]);
    });
    await scenario("upload requires a matching uploading document", "authenticated", web, async () => {
      await client.query("insert into storage.objects (bucket_id,name) values ('documents',$1)", [uploadPath]);
      assert.equal((await client.query("select * from storage.objects")).rowCount, 2);
    });
    await scenario("unregistered storage path is denied", "authenticated", web, () => rejects("insert into storage.objects (bucket_id,name) values ('documents','unknown/path')", "42501"));
    await scenario("other user's upload is denied", "authenticated", web, () => rejects("insert into storage.objects (bucket_id,name) values ('documents',$1)", "42501", [bobPath]));
    await scenario("OAuth cannot read storage directly", "authenticated", oauth, async () => {
      assert.equal((await client.query("select * from storage.objects")).rowCount, 0);
    });
    await scenario("OAuth cannot upload to storage directly", "authenticated", oauth, () => rejects("insert into storage.objects (bucket_id,name) values ('documents',$1)", "42501", [uploadPath]));
    await scenario("client cannot replace an existing object", "authenticated", web, async () => {
      assert.equal((await client.query("update storage.objects set name='replaced' where name=$1", [alicePath])).rowCount, 0);
    });
    await scenario("removing source document preserves excerpt and marks references unavailable", "service_role", {}, async () => {
      await client.query("delete from public.documents where id=$1", [aliceDocument]);
      const { rows } = await client.query("select document_id,section_id,excerpt from public.profile_sources where draft_id=$1", [aliceDraft]);
      assert.deepEqual(rows, [{ document_id: null, section_id: null, excerpt: "Alice excerpt" }]);
    });
    await scenario("source evidence cannot point to another user's section", "service_role", {}, () => rejects("update public.profile_sources set section_id=$1 where draft_id=$2", "23503", [bobSection, aliceDraft]));
    await scenario("source evidence must match the section extraction version", "service_role", {}, () => rejects("update public.profile_sources set extraction_version=2 where draft_id=$1", "23503", [aliceDraft]));
    await scenario("account deletion cleans up the profile and document graph", null, {}, async () => {
      await client.query("delete from auth.users where id=$1", [alice]);
      for (const table of ["collections", "documents", "profiles", "profile_versions", "profile_drafts", "profile_sources"]) {
        assert.equal((await client.query(`select * from public.${table} where owner_id=$1`, [alice])).rowCount, 0, table);
      }
      assert.equal((await client.query("select * from public.profiles where owner_id=$1", [bob])).rowCount, 1);
    });
    await scenario("private bucket has the expected size limit", null, {}, async () => {
      const { rows } = await client.query("select public,file_size_limit from storage.buckets where id='documents'");
      assert.deepEqual(rows, [{ public: false, file_size_limit: "10485760" }]);
    });
  } finally {
    await client.end();
    await cluster.stop();
  }
});
