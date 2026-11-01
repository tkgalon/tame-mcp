import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { extractionResultSchema, MAX_DOCUMENT_BYTES } from "@tame/contracts";
import type { ExtractionResult } from "@tame/contracts";
import { WorkerFault } from "./backend.js";
import { parserVersion } from "./parse-document.js";

export const PARSER_TIMEOUT_MS = 30_000;
export const PARSER_HEAP_MIB = 256;
export const MAX_PARSER_OUTPUT_BYTES = 4 * 1024 * 1024;

type ParserOptions = { signal?: AbortSignal; timeoutMs?: number; entry?: URL };

export function parseInChild(bytes: Uint8Array, mediaType: string, options: ParserOptions = {}): Promise<ExtractionResult> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES || options.signal?.aborted) return Promise.reject(new WorkerFault("worker_error"));
  const timeoutMs = options.timeoutMs ?? PARSER_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PARSER_TIMEOUT_MS) return Promise.reject(new WorkerFault("worker_error"));
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${PARSER_HEAP_MIB}`,
      fileURLToPath(options.entry ?? new URL("../dist/parser-child.js", import.meta.url)), mediaType,
    ], { env, cwd: tmpdir(), stdio: ["pipe", "ignore", "ignore", "pipe"] });
    const output = child.stdio[3] as Readable;
    const chunks: Buffer[] = [];
    let size = 0;
    let fault: WorkerFault | undefined;
    const stop = (code: "parser_timeout" | "parser_crashed" | "worker_error") => {
      fault ??= new WorkerFault(code);
      child.kill("SIGKILL");
    };
    const abort = () => stop("worker_error");
    const timer = setTimeout(() => stop("parser_timeout"), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    output.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_PARSER_OUTPUT_BYTES) stop("parser_crashed");
      else chunks.push(chunk);
    });
    output.on("error", () => stop("parser_crashed"));
    child.stdin!.on("error", () => stop("parser_crashed"));
    child.on("error", () => { fault ??= new WorkerFault("parser_crashed"); });
    child.on("close", code => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (fault || code !== 0) { reject(fault ?? new WorkerFault("parser_crashed")); return; }
      try {
        const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
        const result = extractionResultSchema.parse(raw);
        if (result.contentHash !== expectedHash || result.parserVersion !== parserVersion(mediaType)) throw new Error("Mismatched extraction.");
        resolve(result);
      } catch { reject(new WorkerFault("parser_crashed")); }
    });
    child.stdin!.end(bytes);
  });
}
