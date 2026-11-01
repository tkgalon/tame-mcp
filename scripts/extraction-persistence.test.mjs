import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { processingDatabase, scenario, uploadedDocument, claim, sqlError, alice, bob } from "./processing-test-helpers.mjs";

const base = { contentHash: "a".repeat(64), parserVersion: "markdown-v1", warnings: [] };
function ready(text = "Finding 😀") {
  return { ...base, status: "ready", sections: [{ ordinal: 0, heading: "Evidence", page: null, content: text, sourceStart: 0, sourceEnd: text.length }] };
}
async function finish(client, job, result) {
  return (await client.query("select public.finish_document_job($1,$2,$3) as ok", [job.id, job.lease_token, result])).rows[0].ok;
}

test("extraction persistence is atomic and fenced by the current lease", { timeout: 90_000 }, async t => {
  await processingDatabase(async ({ client, connection }) => {
    await scenario(t, client, "ready results persist Unicode offsets and derive identity from the job", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      await client.query("set local role service_role");
      const result = ready();
      result.warnings = ["section_split"];
      assert.equal(await finish(client, job, result), true);
      const document = (await client.query("select owner_id,status,content_hash,parser_version,warnings,extraction_error_code from public.documents where id=$1", [id])).rows[0];
      assert.deepEqual(document, { owner_id: alice, status: "ready", content_hash: base.contentHash, parser_version: base.parserVersion, warnings: result.warnings, extraction_error_code: null });
      const sections = (await client.query("select owner_id,document_id,extraction_version,ordinal,heading,page,content,source_start,source_end from public.document_sections where document_id=$1", [id])).rows;
      assert.deepEqual(sections, [{ owner_id: alice, document_id: id, extraction_version: 1, ordinal: 0, heading: "Evidence", page: null, content: "Finding 😀", source_start: 0, source_end: "Finding 😀".length }]);
      assert.deepEqual((await client.query("select status,lease_token,lease_until from public.processing_jobs where id=$1", [job.id])).rows[0], { status: "succeeded", lease_token: null, lease_until: null });
    });
    for (const [status, errorCode] of [["needs_ocr", "no_extractable_text"], ["unsupported", "unsupported_media_type"], ["failed", "invalid_document"]]) {
      await scenario(t, client, `${status} saves a terminal state without partial sections`, async () => {
        const id = await uploadedDocument(client);
        const job = await claim(client);
        assert.equal(await finish(client, job, { ...base, status, errorCode }), true);
        assert.deepEqual((await client.query("select status,extraction_error_code from public.documents where id=$1", [id])).rows[0], { status, extraction_error_code: errorCode });
        assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 0);
        assert.equal((await client.query("select status from public.processing_jobs where id=$1", [job.id])).rows[0].status, status === "failed" ? "failed" : "succeeded");
      });
    }
    await scenario(t, client, "repeated completion cannot duplicate or overwrite sections", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      assert.equal(await finish(client, job, ready()), true);
      const original = (await client.query("select * from public.document_sections where document_id=$1", [id])).rows;
      assert.equal(await finish(client, job, ready("replacement")), false);
      assert.deepEqual((await client.query("select * from public.document_sections where document_id=$1", [id])).rows, original);
    });
    await scenario(t, client, "a reclaimed job rejects the previous worker's result", async () => {
      const id = await uploadedDocument(client);
      const first = await claim(client);
      await client.query("update public.processing_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [first.id]);
      const second = await claim(client);
      assert.equal(await finish(client, first, ready("stale")), false);
      assert.equal(await finish(client, second, ready("current")), true);
      assert.equal((await client.query("select content from public.document_sections where document_id=$1", [id])).rows[0].content, "current");
    });
    await scenario(t, client, "expired or missing tokens cannot persist a result", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      assert.equal(await finish(client, { ...job, lease_token: null }, ready()), false);
      await client.query("update public.processing_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      assert.equal(await finish(client, job, ready()), false);
      assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 0);
    });
    await scenario(t, client, "deleting a document prevents a late result from recreating it", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      await client.query("delete from public.documents where id=$1", [id]);
      assert.equal(await finish(client, job, ready()), false);
      assert.equal((await client.query("select * from public.processing_jobs where id=$1", [job.id])).rowCount, 0);
    });
    await scenario(t, client, "superseded jobs cannot persist into a newer extraction version", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      await client.query("update public.documents set extraction_version=2 where id=$1", [id]);
      assert.equal(await finish(client, job, ready()), false);
      assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 0);
    });
    await scenario(t, client, "new extraction results preserve older sections and profile evidence", async () => {
      const id = await uploadedDocument(client);
      await client.query("update public.documents set extraction_version=2 where id=$1", [id]);
      await client.query("update public.processing_jobs set extraction_version=2 where document_id=$1", [id]);
      const oldSection = (await client.query("insert into public.document_sections (owner_id,document_id,extraction_version,ordinal,content) values ($1,$2,1,0,'Original evidence') returning id", [alice, id])).rows[0].id;
      const draft = (await client.query("insert into public.profile_drafts (owner_id,payload) values ($1,'{\"purpose\":\"CTF\"}') returning id", [alice])).rows[0].id;
      await client.query("insert into public.profile_sources (owner_id,draft_id,rule_id,document_id,section_id,extraction_version,excerpt) values ($1,$2,'style',$3,$4,1,'Original evidence')", [alice, draft, id, oldSection]);
      assert.equal(await finish(client, await claim(client), ready("New evidence")), true);
      assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 2);
      assert.equal((await client.query("select section_id from public.profile_sources where draft_id=$1", [draft])).rows[0].section_id, oldSection);
    });
    await scenario(t, client, "invalid results leave the document, lease, and sections unchanged", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      const invalid = [
        null, [], {}, { ...ready(), owner_id: bob }, { ...ready(), contentHash: "secret" },
        { ...ready(), warnings: ["raw private stack trace"] }, { ...ready(), parserVersion: " " },
        { ...ready(), parserVersion: "x".repeat(101) },
        { ...ready(), sections: [] }, { ...ready(), errorCode: "invalid_document" },
        { ...base, status: "failed", errorCode: "raw private error", sections: [] },
        { ...base, status: "needs_ocr", errorCode: "invalid_document" },
        { ...ready(), sections: [{ ...ready().sections[0], owner_id: bob }] },
        { ...ready(), sections: [{ ...ready().sections[0], ordinal: "0" }] },
        { ...ready(), sections: [{ ...ready().sections[0], sourceEnd: 9 }] },
        { ...ready(), sections: [{ ...ready().sections[0], sourceStart: 1 }] },
        { ...ready(), sections: [{ ...ready().sections[0], page: 0 }] },
        { ...ready(), sections: [{ ...ready().sections[0], page: 9999999999 }] },
        { ...ready(), sections: [{ ...ready().sections[0], heading: "x".repeat(501) }] },
        ready("x".repeat(8001)),
      ];
      for (const result of invalid) await sqlError(client, "select public.finish_document_job($1,$2,$3)", [job.id, job.lease_token, result]);
      assert.equal((await client.query("select status from public.documents where id=$1", [id])).rows[0].status, "processing");
      assert.equal((await client.query("select lease_token from public.processing_jobs where id=$1", [job.id])).rows[0].lease_token, job.lease_token);
      assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 0);
      assert.equal(await finish(client, job, ready()), true);
    });
    await scenario(t, client, "a later section insertion failure rolls back all earlier inserts", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      const result = ready("First");
      result.sections.push({ ...result.sections[0], ordinal: 1, content: "Second", sourceStart: 5, sourceEnd: 11 });
      await client.query("create function public.test_reject_section() returns trigger language plpgsql as $$ begin if new.ordinal=1 then raise exception 'test failure'; end if; return new; end $$");
      await client.query("create trigger test_reject_section before insert on public.document_sections for each row execute function public.test_reject_section()");
      await sqlError(client, "select public.finish_document_job($1,$2,$3)", [job.id, job.lease_token, result], "P0001");
      assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 0);
      assert.equal((await client.query("select status from public.documents where id=$1", [id])).rows[0].status, "processing");
      assert.equal((await client.query("select status from public.processing_jobs where id=$1", [job.id])).rows[0].status, "running");
    });
    await scenario(t, client, "an assigned job hash and parser version must match the result", async () => {
      await uploadedDocument(client);
      const job = await claim(client);
      await client.query("update public.processing_jobs set content_hash=repeat('b',64),parser_version='next-version' where id=$1", [job.id]);
      await sqlError(client, "select public.finish_document_job($1,$2,$3)", [job.id, job.lease_token, ready()]);
    });
    for (const role of ["anon", "authenticated"]) await scenario(t, client, `${role} cannot persist extraction results`, async () => {
      await client.query(`set local role ${role}`);
      await sqlError(client, "select public.finish_document_job($1,$2,$3)", [randomUUID(), randomUUID(), ready()], "42501");
      await sqlError(client, "select public.validate_document_extraction($1)", [ready()], "42501");
    });
    await t.test("concurrent completion attempts write one set of sections", async () => {
      const id = await uploadedDocument(client);
      const job = await claim(client);
      const peers = [new Client(connection), new Client(connection)];
      try {
        await Promise.all(peers.map(async peer => {
          await peer.connect();
          await peer.query("set role service_role");
          await peer.query("set statement_timeout='2s'");
        }));
        const accepted = await Promise.all(peers.map(peer => finish(peer, job, ready())));
        assert.deepEqual(accepted.sort(), [false, true]);
        assert.equal((await client.query("select * from public.document_sections where document_id=$1", [id])).rowCount, 1);
      } finally {
        await Promise.all(peers.map(peer => peer.end()));
        await client.query("delete from public.documents where id=$1", [id]);
      }
    });
  });
});
