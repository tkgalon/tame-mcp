import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
const mode = bytes.toString();
if (mode === "hang") await new Promise(() => { setInterval(() => {}, 1000); });
if (mode === "crash") process.exit(2);
if (mode === "garbage") await pipeline(Readable.from(["private invalid output"]), createWriteStream("", { fd: 3 }));
else if (mode === "overflow") await pipeline(Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1)]), createWriteStream("", { fd: 3 }));
else {
  const content = process.env.TAME_SUPABASE_SECRET_KEY || process.env.NODE_OPTIONS || process.env.TAME_TEST_SECRET
    || (process.execArgv.includes("--max-old-space-size=256") ? "clean" : "missing heap limit");
  const result = { status: "ready", contentHash: createHash("sha256").update(bytes).digest("hex"), parserVersion: "plain-text-v1", warnings: [], sections: [{ ordinal: 0, heading: null, page: null, content, sourceStart: 0, sourceEnd: content.length }] };
  if (mode === "wronghash") result.contentHash = "a".repeat(64);
  if (mode === "wrongversion") result.parserVersion = "unexpected-v1";
  await pipeline(Readable.from([JSON.stringify(result)]), createWriteStream("", { fd: 3 }));
}
