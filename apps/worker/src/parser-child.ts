import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { parseDocument } from "./parse-document.js";

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_DOCUMENT_BYTES) throw new Error("Input limit exceeded.");
    chunks.push(bytes);
  }
  const result = extractionResultSchema.parse(await parseDocument(Buffer.concat(chunks, size), process.argv[2] ?? ""));
  // Results use a dedicated pipe so library diagnostics cannot become document content
  await pipeline(Readable.from([JSON.stringify(result)]), createWriteStream("", { fd: 3 }));
}

main().catch(() => { process.exitCode = 1; });
