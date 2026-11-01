import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { processingDatabase, scenario, uploadedDocument, claim, sqlError, alice, bob, bobCollection } from "./processing-test-helpers.mjs";

test("processing queue lifecycle and access boundaries", { timeout: 90_000 }, async t => {
  await processingDatabase(async ({ client, connection }) => {
    await scenario(t, client, "upload confirmation queues one job before a hash is available", async () => {
      const id = await uploadedDocument(client);
      await client.query("select public.complete_document_upload($1)", [id]);
      const { rows } = await client.query("select * from public.processing_jobs where document_id=$1", [id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "queued");
      assert.equal(rows[0].content_hash, null);
      assert.equal(rows[0].parser_version, null);
      assert.equal(rows[0].extraction_version, 1);
    });
    await scenario(t, client, "failed upload verification does not queue a job", async () => {
      await sqlError(client, "select public.complete_document_upload($1)", [randomUUID()], "P0002");
      assert.equal((await client.query("select * from public.processing_jobs")).rowCount, 0);
    });
    await scenario(t, client, "job insertion failure rolls upload confirmation back", async () => {
      const id = await uploadedDocument(client, { status: "uploading" });
      await client.query("delete from public.processing_jobs where document_id=$1", [id]);
      await client.query("update public.documents set status='uploading' where id=$1", [id]);
      await client.query("create function public.test_reject_job() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$");
      await client.query("create trigger test_reject_job before insert on public.processing_jobs for each row execute function public.test_reject_job()");
      await sqlError(client, "select public.complete_document_upload($1)", [id], "P0001");
      assert.equal((await client.query("select status from public.documents where id=$1", [id])).rows[0].status, "uploading");
    });
    await scenario(t, client, "claim assigns a lease and registered storage metadata", async () => {
      const id = await uploadedDocument(client);
      await client.query("set local role service_role");
      const job = await claim(client);
      assert.equal(job.document_id, id);
      assert.equal(job.owner_id, alice);
      assert.equal(job.storage_path, `${alice}/${id}/original`);
      assert.equal(job.media_type, "text/markdown");
      assert.equal(job.size_bytes, 10);
      assert.equal(job.attempts, 1);
      assert.ok(job.lease_token);
      assert.equal((await client.query("select status from public.documents where id=$1", [id])).rows[0].status, "processing");
      assert.equal(await claim(client), null);
    });
    await scenario(t, client, "lease expiration issues a new token and consumes an attempt", async () => {
      await uploadedDocument(client);
      const first = await claim(client);
      await client.query("update public.processing_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [first.id]);
      const second = await claim(client);
      assert.equal(second.id, first.id);
      assert.equal(second.attempts, 2);
      assert.notEqual(second.lease_token, first.lease_token);
      assert.equal((await client.query("select public.retry_document_job($1,$2,'worker_error') as ok", [first.id, first.lease_token])).rows[0].ok, false);
    });
    await scenario(t, client, "transient errors back off and stop after three claims", async () => {
      const id = await uploadedDocument(client);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const job = await claim(client);
        assert.equal(job.attempts, attempt);
        assert.equal((await client.query("select public.retry_document_job($1,$2,'storage_unavailable') as ok", [job.id, job.lease_token])).rows[0].ok, true);
        const state = (await client.query("select * from public.processing_jobs where id=$1", [job.id])).rows[0];
        assert.equal(state.status, attempt < 3 ? "queued" : "failed");
        assert.equal(state.lease_token, null);
        assert.ok(state.next_run_at > new Date());
        assert.equal(await claim(client), null);
        await client.query("update public.processing_jobs set next_run_at=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      }
      const document = (await client.query("select status,extraction_error_code from public.documents where id=$1", [id])).rows[0];
      assert.deepEqual(document, { status: "failed", extraction_error_code: "storage_unavailable" });
      assert.equal(await claim(client), null);
    });
    await scenario(t, client, "three crashed attempts are terminal after the final lease expires", async () => {
      const id = await uploadedDocument(client);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const job = await claim(client);
        assert.equal(job.attempts, attempt);
        await client.query("update public.processing_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      }
      assert.equal(await claim(client), null);
      assert.deepEqual((await client.query("select status,extraction_error_code from public.documents where id=$1", [id])).rows[0], { status: "failed", extraction_error_code: "lease_expired" });
    });
    await scenario(t, client, "superseded jobs cannot reset a newer extraction", async () => {
      const id = await uploadedDocument(client);
      await client.query("update public.documents set extraction_version=2 where id=$1", [id]);
      assert.equal(await claim(client), null);
      assert.equal((await client.query("select error_code from public.processing_jobs where document_id=$1", [id])).rows[0].error_code, "job_superseded");
      assert.equal((await client.query("select extraction_version from public.documents where id=$1", [id])).rows[0].extraction_version, 2);
    });
    await scenario(t, client, "terminal documents are not brought back into processing", async () => {
      const id = await uploadedDocument(client);
      await client.query("update public.documents set status='ready' where id=$1", [id]);
      assert.equal(await claim(client), null);
      assert.equal((await client.query("select status from public.documents where id=$1", [id])).rows[0].status, "ready");
    });
    await scenario(t, client, "one document cannot have two active jobs", async () => {
      const id = await uploadedDocument(client);
      await sqlError(client, "insert into public.processing_jobs (owner_id,document_id) values ($1,$2)", [alice, id], "23505");
    });
    await scenario(t, client, "expired, wrong, and missing tokens cannot release jobs", async () => {
      await uploadedDocument(client);
      const job = await claim(client);
      for (const token of [randomUUID(), null]) assert.equal((await client.query("select public.retry_document_job($1,$2,'worker_error') as ok", [job.id, token])).rows[0].ok, false);
      await client.query("update public.processing_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      assert.equal((await client.query("select public.retry_document_job($1,$2,'worker_error') as ok", [job.id, job.lease_token])).rows[0].ok, false);
    });
    for (const role of ["anon", "authenticated"]) await scenario(t, client, `${role} cannot call worker RPCs`, async () => {
      await client.query(`set local role ${role}`);
      await sqlError(client, "select public.claim_document_job()", [], "42501");
      await sqlError(client, "select public.retry_document_job($1,$2,'worker_error')", [randomUUID(), randomUUID()], "42501");
    });
    await scenario(t, client, "lease and retry parameters are bounded", async () => {
      for (const duration of [null, 0, 14, 301]) await sqlError(client, "select public.claim_document_job($1)", [duration]);
      await sqlError(client, "select public.retry_document_job($1,$2,$3)", [randomUUID(), randomUUID(), "private raw stack trace"]);
    });
    await t.test("concurrent workers skip locked jobs and claim distinct documents", async () => {
      const firstId = await uploadedDocument(client);
      const secondId = await uploadedDocument(client, { owner: bob, collection: bobCollection });
      const peers = [new Client(connection), new Client(connection)];
      try {
        await Promise.all(peers.map(async peer => {
          await peer.connect();
          await peer.query("begin");
          await peer.query("set local role service_role");
          await peer.query("set local statement_timeout='2s'");
        }));
        const jobs = await Promise.all(peers.map(peer => claim(peer)));
        assert.deepEqual(new Set(jobs.map(job => job.document_id)), new Set([firstId, secondId]));
        await Promise.all(peers.map(peer => peer.query("commit")));
        assert.equal(await claim(client), null);
      } finally {
        await Promise.all(peers.map(async peer => { await peer.query("rollback").catch(() => {}); await peer.end(); }));
        await client.query("delete from public.documents where id=any($1::uuid[])", [[firstId, secondId]]);
      }
    });
  });
});

test("queue migration includes previously confirmed uploads", { timeout: 90_000 }, async () => {
  await processingDatabase(async ({ client, migrate }) => {
    const uploaded = await uploadedDocument(client, { status: "uploaded" });
    const ready = await uploadedDocument(client, { status: "ready" });
    await migrate("20261101000500_processing_queue.sql");
    assert.deepEqual((await client.query("select document_id from public.processing_jobs")).rows, [{ document_id: uploaded }]);
    assert.equal((await client.query("select status from public.documents where id=$1", [ready])).rows[0].status, "ready");
  }, 4);
});
