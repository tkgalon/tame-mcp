import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readAuthConfig } from "../auth/config";

export async function createSupabaseServerClient({ readOnly = false } = {}) {
  const config = readAuthConfig();
  if (!config) throw new Error("Supabase authentication is not configured.");
  const cookieStore = await cookies();

  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(config.siteUrl).protocol === "https:",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Server Components read cookies refreshed by the request proxy
        if (readOnly) return;
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      },
    },
  });
}
