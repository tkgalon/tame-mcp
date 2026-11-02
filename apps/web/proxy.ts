import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { publicConfig } from "./lib/env";

// Refreshes the session cookie on page requests. Each page and action still checks the user itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = publicConfig();
  const supabase = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.siteUrl.startsWith("https:") },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!mcp|\\.well-known|api/health|_next/static|_next/image|favicon.ico).*)"],
};
