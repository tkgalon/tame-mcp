import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { readAuthConfig } from "../../../lib/auth/config";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048 || !readAuthConfig()) redirect("/login?error=confirmation");
  let succeeded = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    succeeded = !error;
  } catch {
    succeeded = false;
  }
  redirect(succeeded ? "/" : "/login?error=confirmation");
}
