import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readAuthConfig } from "../auth/config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const authHeaders = new Map([["Cache-Control", "private, no-store"]]);
  response.headers.set("Cache-Control", "private, no-store");
  const config = readAuthConfig();
  if (!config) return response;

  const supabase = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(config.siteUrl).protocol === "https:",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        for (const [name, value] of Object.entries(headers)) authHeaders.set(name, value);
        for (const [name, value] of authHeaders) response.headers.set(name, value);
        for (const cookie of previousCookies) response.cookies.set(cookie);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Refresh cookies here and enforce authorization again at each protected boundary
  await supabase.auth.getUser();
  return response;
}
