import { z } from "zod";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const serviceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname));
}, "Use HTTPS or a local development URL.");

const publicSchema = z.object({
  supabaseUrl: serviceUrl.transform((value) => new URL(value).origin),
  publishableKey: z.string().startsWith("sb_publishable_"),
  siteUrl: serviceUrl.transform((value) => new URL(value).origin),
});

const serverSchema = publicSchema.extend({
  secretKey: z.string().startsWith("sb_secret_"),
  databaseUrl: z.string().startsWith("postgresql://"),
});

export type PublicConfig = z.infer<typeof publicSchema>;
export type ServerConfig = z.infer<typeof serverSchema>;

function read(env: Record<string, string | undefined>) {
  return {
    supabaseUrl: env["NEXT_PUBLIC_SUPABASE_URL"],
    publishableKey: env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    siteUrl: env["TAME_SITE_URL"],
    secretKey: env["TAME_SUPABASE_SECRET_KEY"],
    databaseUrl: env["TAME_DATABASE_URL"],
  };
}

export function publicConfig(env: Record<string, string | undefined> = process.env): PublicConfig {
  return publicSchema.parse(read(env));
}

export function serverConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return serverSchema.parse(read(env));
}

export const mcpResourceUrl = (config: PublicConfig) => `${config.siteUrl}/mcp`;
