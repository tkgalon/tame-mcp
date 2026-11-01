import { z } from "zod";

function serviceUrl(value: string): boolean {
  const url = URL.parse(value);
  if (!url) return false;
  return !url.username && !url.password && !url.search && !url.hash
    && (url.protocol === "https:" || (url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
}
function backendKey(value: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const claims: unknown = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8"));
    return value.split(".").length === 3 && typeof claims === "object" && claims !== null
      && "role" in claims && claims.role === "service_role";
  } catch { return false; }
}
const urlSchema = z.url().refine(serviceUrl);
const configSchema = z.object({
  resourceUrl: urlSchema.refine(value => URL.parse(value)?.pathname === "/mcp"),
  supabaseUrl: urlSchema.refine(value => URL.parse(value)?.pathname === "/").transform(value => new URL(value).origin),
  secretKey: z.string().min(1).refine(backendKey),
  allowedOrigins: z.array(urlSchema.refine(value => URL.parse(value)?.pathname === "/").transform(value => new URL(value).origin)).max(20),
});
export type McpConfig = z.infer<typeof configSchema>;

export function readMcpConfig(env: Readonly<Record<string, string | undefined>> = process.env): McpConfig | null {
  const result = configSchema.safeParse({
    resourceUrl: env["TAME_MCP_URL"], supabaseUrl: env["TAME_SUPABASE_URL"], secretKey: env["TAME_SUPABASE_SECRET_KEY"],
    allowedOrigins: env["MCP_ALLOWED_ORIGINS"]?.split(",").map(value => value.trim()) ?? [],
  });
  return result.success ? result.data : null;
}
