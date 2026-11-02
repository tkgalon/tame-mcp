import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createSessionClient } from "../../../lib/supabase";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048) redirect("/login");
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  redirect(error ? "/login" : "/");
}
