import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import type { ExtractionResult } from "@tame/contracts";
import { parserVersion } from "./parse.js";

export const PARSER_TIMEOUT_MS = 30_000;
export const PARSER_HEAP_MIB = 256;
export const MAX_PARSER_OUTPUT_BYTES = 4 * 1024 * 1024;

export type ExtractionRunErrorCode = "input_too_large" | "parser_timeout" | "parser_crashed";

export class ExtractionRunError extends Error {
  constructor(readonly code: ExtractionRunErrorCode) {
    super(code);
  }
}

const CHILD_ENTRY = new URL("./child.js", import.meta.url);
const INHERITED_ENV = ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"];

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

// Parsers run in a separate process so a malformed file cannot exhaust the server's memory
export function extractDocument(
  bytes: Uint8Array,
  mediaType: string,
  timeoutMs = PARSER_TIMEOUT_MS,
): Promise<ExtractionResult> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return Promise.reject(new ExtractionRunError("input_too_large"));
  }
  const expectedHash = createHash("sha256").update(bytes).digest("hex");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${PARSER_HEAP_MIB}`, fileURLToPath(CHILD_ENTRY), mediaType],
      { env: childEnv(), cwd: tmpdir(), stdio: ["pipe", "ignore", "ignore", "pipe"] },
    );
    const input = child.stdin;
    const output = child.stdio[3] as Readable;
    if (!input) {
      child.kill("SIGKILL");
      reject(new ExtractionRunError("parser_crashed"));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: ExtractionRunError | undefined;

    const stop = (code: ExtractionRunErrorCode) => {
      failure ??= new ExtractionRunError(code);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("parser_timeout"), timeoutMs);

    output.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_PARSER_OUTPUT_BYTES) stop("parser_crashed");
      else chunks.push(chunk);
    });
    output.on("error", () => stop("parser_crashed"));
    input.on("error", () => stop("parser_crashed"));
    child.on("error", () => stop("parser_crashed"));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (failure || exitCode !== 0) {
        reject(failure ?? new ExtractionRunError("parser_crashed"));
        return;
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
        const result = extractionResultSchema.parse(JSON.parse(text));
        if (result.contentHash !== expectedHash || result.parserVersion !== parserVersion(mediaType)) {
          throw new Error("The parser returned a result for different input.");
        }
        resolve(result);
      } catch {
        reject(new ExtractionRunError("parser_crashed"));
      }
    });

    input.end(bytes);
  });
}
