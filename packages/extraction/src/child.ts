import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { parseDocument } from "./parse.js";

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > MAX_DOCUMENT_BYTES) throw new Error("Input limit exceeded.");
    chunks.push(bytes);
  }
  const result = await parseDocument(Buffer.concat(chunks, size), process.argv[2] ?? "");
  const output = JSON.stringify(extractionResultSchema.parse(result));
  // Results use a dedicated pipe so library logs on stdout cannot become document content
  await pipeline(Readable.from([output]), createWriteStream("", { fd: 3 }));
}

main().catch(() => {
  process.exitCode = 1;
});
