import { z } from "zod";

function isPublicKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  try {
    const payload = key.split(".")[1];
    if (!payload) return false;
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && "role" in claims && claims.role === "anon";
  } catch {
    return false;
  }
}

const serviceUrl = z.url().refine(value => {
  const url = URL.parse(value);
  if (!url) return false;
  return url.protocol === "https:" || (
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}, "Use HTTPS or a local development URL.");

const configSchema = z.object({
  supabaseUrl: serviceUrl,
  publishableKey: z.string().min(1).refine(isPublicKey),
  siteUrl: serviceUrl.transform(value => new URL(value).origin),
});

export type AuthConfig = z.infer<typeof configSchema>;

export function readAuthConfig(env: Readonly<Record<string, string | undefined>> = process.env): AuthConfig | null {
  const parsed = configSchema.safeParse({
    supabaseUrl: env["NEXT_PUBLIC_SUPABASE_URL"],
    publishableKey: env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    siteUrl: env["TAME_SITE_URL"],
  });
  return parsed.success ? parsed.data : null;
}
