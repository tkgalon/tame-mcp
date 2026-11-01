import { z } from "zod";

function isBackendKey(value: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const payload: unknown = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8"));
    return value.split(".").length === 3 && typeof payload === "object" && payload !== null
      && "role" in payload && payload.role === "service_role";
  } catch { return false; }
}

const configSchema = z.object({
  supabaseUrl: z.url().refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
      && (url.protocol === "https:" || (url.protocol === "http:"
        && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
  }).transform(value => new URL(value).origin),
  secretKey: z.string().min(1).refine(isBackendKey),
  pollMs: z.coerce.number().int().min(250).max(30_000),
});

export type WorkerConfig = z.infer<typeof configSchema>;

export function readWorkerConfig(env: Readonly<Record<string, string | undefined>> = process.env): WorkerConfig | null {
  const parsed = configSchema.safeParse({
    supabaseUrl: env["TAME_SUPABASE_URL"], secretKey: env["TAME_SUPABASE_SECRET_KEY"],
    pollMs: env["TAME_WORKER_POLL_MS"] ?? 2_000,
  });
  return parsed.success ? parsed.data : null;
}
