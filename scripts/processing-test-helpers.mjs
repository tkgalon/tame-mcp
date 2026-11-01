import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";
import { temporaryPostgres } from "./temporary-postgres.mjs";

export const alice = "11111111-1111-4111-8111-111111111111";
export const bob = "22222222-2222-4222-8222-222222222222";
export const aliceCollection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const bobCollection = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migrations = new URL("../supabase/migrations/", import.meta.url);

export async function processingDatabase(body, migrationCount = Infinity) {
  const cluster = await temporaryPostgres();
  const client = new Client(cluster.connection);
  try {
    await client.connect();
    await client.query(await readFile(new URL("./database-fixture.sql", import.meta.url), "utf8"));
    const names = (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort();
    for (const name of names.slice(0, migrationCount)) await client.query(await readFile(new URL(name, migrations), "utf8"));
    await client.query("insert into auth.users values ($1),($2)", [alice, bob]);
    await client.query("insert into public.collections (id,owner_id,name) values ($1,$2,'Alice'),($3,$4,'Bob')", [aliceCollection, alice, bobCollection, bob]);
    await body({ client, connection: cluster.connection, migrate: async name => client.query(await readFile(new URL(name, migrations), "utf8")) });
  } finally {
    await client.end();
    await cluster.stop();
  }
}

export async function scenario(t, client, name, body) {
  await t.test(name, async () => {
    await client.query("begin");
    try {
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: alice })]);
      await body();
    } finally { await client.query("rollback"); }
  });
}

export async function uploadedDocument(client, { owner = alice, collection = aliceCollection, status = "uploading" } = {}) {
  const id = randomUUID();
  const path = `${owner}/${id}/original`;
  await client.query("insert into public.documents (id,owner_id,collection_id,name,media_type,size_bytes,storage_path,status) values ($1,$2,$3,'example.md','text/markdown',10,$4,$5)", [id, owner, collection, path, status]);
  await client.query("insert into storage.objects (bucket_id,name,metadata) values ('documents',$1,$2)", [path, { size: 10, mimetype: "text/markdown" }]);
  await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner })]);
  if (status === "uploading") await client.query("select public.complete_document_upload($1)", [id]);
  return id;
}

export async function claim(client, seconds = 120) {
  return (await client.query("select public.claim_document_job($1) as job", [seconds])).rows[0].job;
}

export async function sqlError(client, text, values, code = "22023") {
  await client.query("savepoint expected_failure");
  try { await assert.rejects(client.query(text, values), error => error.code === code); }
  finally {
    await client.query("rollback to savepoint expected_failure");
    await client.query("release savepoint expected_failure");
  }
}
