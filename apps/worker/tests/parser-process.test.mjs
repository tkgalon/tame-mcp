import assert from "node:assert/strict";
import test from "node:test";
import { parseInChild } from "../dist/parser-process.js";
import { MAX_DOCUMENT_BYTES } from "@tame/contracts";
const entry = new URL("./fixtures/parser-fixture.mjs", import.meta.url);
const bytes = text => Buffer.from(text);

test("child extracts actual TXT and Markdown without changing input bytes", async () => {
  for (const [mediaType, source, heading] of [["text/plain", "Finding 😀\n  code", null], ["text/markdown", "# Evidence\n\nFinding", "Evidence"]]) {
    const input = bytes(source);
    const result = await parseInChild(input, mediaType);
    assert.equal(result.status, "ready");
    assert.equal(result.sections.map(section => section.content).join(""), source);
    assert.equal(result.sections[0].heading, heading);
    assert.equal(input.toString(), source);
  }
});

test("child dispatches PDF, DOCX and unsupported types to the expected parser", async () => {
  for (const [mediaType, version, status] of [
    ["application/pdf", "pdf-v1", "failed"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx-v1", "failed"],
    ["other/type", "unsupported-v1", "unsupported"],
  ]) {
    const result = await parseInChild(bytes("wrong format"), mediaType);
    assert.equal(result.status, status);
    assert.equal(result.parserVersion, version);
  }
});

test("parser child receives no backend credentials or inherited Node options", async () => {
  const values = { TAME_SUPABASE_SECRET_KEY: "sb_secret_private", NODE_OPTIONS: "--no-warnings", TAME_TEST_SECRET: "private marker" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const result = await parseInChild(bytes("env"), "text/plain", { entry });
    assert.equal(result.sections[0].content, "clean");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("timeout kills a parser and reports only a stable retry code", async () => {
  await assert.rejects(parseInChild(bytes("hang"), "text/plain", { entry, timeoutMs: 150 }), error => error.code === "parser_timeout");
});

test("crashes, invalid output, excessive output, and mismatched provenance are rejected", async () => {
  for (const mode of ["crash", "garbage", "overflow", "wronghash", "wrongversion"]) {
    await assert.rejects(parseInChild(bytes(mode), "text/plain", { entry }), error => error.code === "parser_crashed" && !error.message.includes("private"));
  }
});

test("shutdown aborts a running parser and rejects oversized input before spawning", async () => {
  const shutdown = new AbortController();
  const result = parseInChild(bytes("hang"), "text/plain", { entry, signal: shutdown.signal });
  setTimeout(() => shutdown.abort(), 100);
  await assert.rejects(result, error => error.code === "worker_error");
  await assert.rejects(parseInChild(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "text/plain"), error => error.code === "worker_error");
});
