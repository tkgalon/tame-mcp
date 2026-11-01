import { MAX_DOCUMENT_BYTES } from "@tame/contracts";
import type { ExtractionResult } from "@tame/contracts";
import { z } from "zod";
import type { WorkerConfig } from "./config.js";

export type RetryCode = "storage_unavailable" | "parser_timeout" | "parser_crashed" | "worker_error";
export class WorkerFault extends Error {
  constructor(readonly code: RetryCode) { super(code); }
}

export const claimedJobSchema = z.object({
  id: z.uuid(), owner_id: z.uuid(), document_id: z.uuid(), lease_token: z.uuid(),
  status: z.literal("running"), lease_until: z.iso.datetime({ offset: true }),
  attempts: z.number().int().min(1).max(3), extraction_version: z.number().int().positive(),
  size_bytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  media_type: z.enum(["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  storage_path: z.string(), content_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  parser_version: z.string().min(1).max(100).nullable(),
}).refine(job => job.storage_path === `${job.owner_id}/${job.document_id}/original`);
export type ClaimedJob = z.infer<typeof claimedJobSchema>;

export interface WorkerBackend {
  claim(signal: AbortSignal): Promise<ClaimedJob | null>;
  download(job: ClaimedJob, signal: AbortSignal): Promise<Uint8Array>;
  finish(job: ClaimedJob, result: ExtractionResult, signal: AbortSignal): Promise<boolean>;
  retry(job: ClaimedJob, code: RetryCode, signal: AbortSignal): Promise<boolean>;
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new WorkerFault("worker_error");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new WorkerFault("worker_error");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createBackend(config: WorkerConfig, request: typeof fetch = fetch): WorkerBackend {
  const headers: Record<string, string> = { apikey: config.secretKey };
  if (!config.secretKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${config.secretKey}`;

  async function rpc(name: string, body: object, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await request(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST", redirect: "error", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) { await response.body?.cancel(); throw new WorkerFault("worker_error"); }
      return JSON.parse((await boundedBody(response, 64 * 1024)).toString("utf8")) as unknown;
    } catch { throw new WorkerFault("worker_error"); }
  }

  return {
    async claim(signal) {
      const result = await rpc("claim_document_job", { p_lease_seconds: 120 }, signal);
      if (result === null) return null;
      const parsed = claimedJobSchema.safeParse(result);
      if (!parsed.success) throw new WorkerFault("worker_error");
      return parsed.data;
    },
    async download(job, signal) {
      try {
        const path = job.storage_path.split("/").map(encodeURIComponent).join("/");
        const response = await request(`${config.supabaseUrl}/storage/v1/object/authenticated/documents/${path}`, {
          headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new WorkerFault("storage_unavailable"); }
        const bytes = await boundedBody(response, Math.min(job.size_bytes, MAX_DOCUMENT_BYTES));
        if (bytes.byteLength !== job.size_bytes) throw new WorkerFault("worker_error");
        return bytes;
      } catch (error) {
        throw error instanceof WorkerFault ? error : new WorkerFault("storage_unavailable");
      }
    },
    async finish(job, result, signal) {
      const value = await rpc("finish_document_job", { p_job_id: job.id, p_lease_token: job.lease_token, p_result: result }, signal);
      if (typeof value !== "boolean") throw new WorkerFault("worker_error");
      return value;
    },
    async retry(job, code, signal) {
      const value = await rpc("retry_document_job", { p_job_id: job.id, p_lease_token: job.lease_token, p_error_code: code }, signal);
      if (typeof value !== "boolean") throw new WorkerFault("worker_error");
      return value;
    },
  };
}
