import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicConfig, serverConfig } from "./env";

// Server Components cannot write cookies, so only actions and route handlers refresh them here
export async function createSessionClient({ readOnly = false } = {}) {
  const config = publicConfig();
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.siteUrl.startsWith("https:") },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        if (readOnly) return;
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      },
    },
  });
}

export function createAdminClient() {
  const config = serverConfig();
  return createClient(config.supabaseUrl, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
