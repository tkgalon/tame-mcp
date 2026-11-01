import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createExampleRepository } from "../dist/examples.js";
import { createMcpServer } from "../dist/server.js";

const owner = randomUUID(), other = randomUUID(), collectionId = randomUUID(), documentId = randomUUID();
const principal = { ownerId: owner, clientId: randomUUID(), connectionId: randomUUID(), sessionId: randomUUID(), permissions: ["read_examples"] };
const collection = { id: collectionId, owner_id: owner, name: "CTF", created_at: "2026-11-01T00:00:00Z" };
const document = { id: documentId, owner_id: owner, collection_id: collectionId, name: "writeup.md", media_type: "text/markdown", size_bytes: 10, status: "ready", created_at: collection.created_at, extraction_version: 1, warnings: [] };
const sections = Array.from({ length: 5 }, (_, ordinal) => ({ id: randomUUID(), owner_id: owner, document_id: documentId, extraction_version: 1, ordinal, heading: null, page: null, content: `Text ${ordinal}`, source_start: ordinal * 6, source_end: ordinal * 6 + 6 }));
function fixture(transform = data => data, secretKey = "sb_secret_fixture") {
  const calls = [];
  const repository = createExampleRepository({ supabaseUrl: "https://project.supabase.co", secretKey }, async (value, init) => {
    const url = new URL(value), params = url.searchParams, table = url.pathname.split("/").at(-1);
    calls.push({ url, init });
    assert.equal(params.get("owner_id"), `eq.${owner}`);
    let data = table === "collections" ? [collection] : table === "documents" ? [document] : sections;
    for (const key of ["id", "collection_id", "document_id", "extraction_version"]) {
      if (params.has(key)) data = data.filter(row => String(row[key]) === params.get(key).slice(3));
    }
    if (params.has("ordinal")) data = data.filter(row => row.ordinal > Number(params.get("ordinal").slice(3)));
    data = data.slice(Number(params.get("offset") ?? 0), Number(params.get("offset") ?? 0) + Number(params.get("limit")));
    return Response.json(transform(data, table, calls));
  });
  return { repository, calls };
}

test("example reads use backend credentials, owner filters and public field allowlists", async () => {
  const { repository, calls } = fixture(data => data.map(row => ({ ...row, storage_path: "private/path", provider_secret: "hidden" })));
  assert.deepEqual(await repository.listCollections(principal, {}), { items: [{ id: collectionId, name: "CTF", created_at: collection.created_at }], nextPage: null });
  const listed = await repository.listDocuments(principal, { collectionId: collectionId.toUpperCase() });
  assert.equal(listed.items[0].id, documentId);
  const read = await repository.readDocument(principal, { documentId });
  assert.deepEqual(read.sections.map(item => item.ordinal), [0, 1, 2]);
  assert.equal(read.nextAfter, 2);
  assert.equal(read.extractionVersion, 1);
  assert.equal(JSON.stringify({ listed, read }).includes("owner_id"), false);
  assert.equal(JSON.stringify({ listed, read }).includes("private/path"), false);
  assert.equal(JSON.stringify({ listed, read }).includes("hidden"), false);
  for (const { init } of calls) {
    assert.equal(init.headers.apikey, "sb_secret_fixture");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
  }
  const legacy = fixture(undefined, "legacy-service-jwt");
  await legacy.repository.listCollections(principal, {});
  assert.equal(legacy.calls[0].init.headers.Authorization, "Bearer legacy-service-jwt");
});

test("section continuation pins extraction version and terminates without duplicates", async () => {
  const { repository, calls } = fixture();
  const second = await repository.readDocument(principal, { documentId, version: 1, after: 2 });
  assert.deepEqual(second.sections.map(item => item.ordinal), [3, 4]);
  assert.equal(second.nextAfter, null);
  await assert.rejects(repository.readDocument(principal, { documentId, after: 2 }));
  const count = calls.length;
  await assert.rejects(repository.readDocument(principal, { documentId, version: 2 }), { code: "extraction_changed" });
  assert.equal(calls.length, count + 1);
});

test("list pagination returns a bounded page and requests a single lookahead row", async () => {
  const { repository, calls } = fixture((data, table) => table === "collections" ? Array.from({ length: 21 }, () => ({ ...collection, id: randomUUID() })) : data);
  const page = await repository.listCollections(principal, { page: 2 });
  assert.equal(page.items.length, 20);
  assert.equal(page.nextPage, 3);
  assert.equal(calls[0].url.searchParams.get("offset"), "20");
  assert.equal(calls[0].url.searchParams.get("limit"), "21");
  assert.equal(calls[0].url.searchParams.get("order"), "created_at.desc,id.desc");
});

test("missing permission prevents all provider requests", async () => {
  const { repository, calls } = fixture();
  const denied = { ...principal, permissions: ["read_profiles", "write_profiles"] };
  await assert.rejects(repository.listCollections(denied, {}), { code: "permission_denied" });
  await assert.rejects(repository.listDocuments(denied, { collectionId }), { code: "permission_denied" });
  await assert.rejects(repository.readDocument(denied, { documentId }), { code: "permission_denied" });
  assert.equal(calls.length, 0);
});

test("missing resources and non-ready documents return stable errors", async () => {
  const { repository } = fixture();
  await assert.rejects(repository.listDocuments(principal, { collectionId: randomUUID() }), { code: "not_found" });
  await assert.rejects(repository.readDocument(principal, { documentId: randomUUID() }), { code: "not_found" });
  const pending = fixture((data, table) => table === "documents" ? data.map(row => ({ ...row, status: "needs_ocr" })) : data);
  await assert.rejects(pending.repository.readDocument(principal, { documentId }), { code: "extraction_not_ready" });
  assert.equal(pending.calls.length, 1);
});

test("provider scope mismatches and corrupt sections fail closed", async () => {
  for (const transform of [
    data => data.map(row => ({ ...row, owner_id: other })),
    (data, table) => table === "document_sections" ? data.map(row => ({ ...row, document_id: randomUUID() })) : data,
    (data, table) => table === "document_sections" ? data.map(row => ({ ...row, extraction_version: 2 })) : data,
    (data, table) => table === "document_sections" ? data.map(row => ({ ...row, source_end: 999 })) : data,
    (data, table) => table === "document_sections" ? [...data].reverse() : data,
  ]) {
    await assert.rejects(fixture(transform).repository.readDocument(principal, { documentId }), { code: "examples_unavailable" });
  }
});

test("an extraction change during a paginated read discards the response", async () => {
  const { repository } = fixture((data, table, calls) => table === "documents" && calls.length > 1 ? data.map(row => ({ ...row, extraction_version: 2 })) : data);
  await assert.rejects(repository.readDocument(principal, { documentId }), { code: "extraction_changed" });
});

test("provider failures and oversized bodies never expose backend details", async () => {
  for (const response of [new Response("private provider detail", { status: 500 }), new Response("x".repeat(512 * 1024 + 1)), Response.json({ invalid: true })]) {
    const repository = createExampleRepository({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_fixture" }, async () => response);
    await assert.rejects(repository.listCollections(principal, {}), error => error.code === "examples_unavailable" && !error.message.includes("private"));
  }
});

test("real SDK discovers and calls example tools with strict inputs and permission checks", async () => {
  for (const allowed of [true, false]) {
    const { repository, calls } = fixture();
    const server = createMcpServer({ ...principal, permissions: allowed ? ["read_examples"] : ["read_profiles"] }, repository);
    const client = new Client({ name: "examples-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: "read_document", arguments: { documentId } });
      if (allowed) {
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.sections.length, 3);
        assert.equal((await client.callTool({ name: "list_collections", arguments: {} })).structuredContent.items[0].id, collectionId);
        assert.equal((await client.callTool({ name: "list_documents", arguments: { collectionId } })).structuredContent.items[0].id, documentId);
        for (const args of [{ documentId, ownerId: other }, { documentId, after: 2 }, { documentId: "invalid" }]) {
          assert.equal((await client.callTool({ name: "read_document", arguments: args })).isError, true);
        }
      } else {
        assert.equal(result.isError, true);
        assert.deepEqual(JSON.parse(result.content[0].text), { error: "permission_denied" });
        assert.equal(calls.length, 0);
      }
    } finally { await client.close(); await server.close(); }
  }
});
