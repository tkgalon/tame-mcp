import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/", "/login", "/signup", "/auth/:path*", "/collections/:path*",
    "/oauth/:path*", "/api/collections/:path*", "/api/documents/:path*",
  ],
};
