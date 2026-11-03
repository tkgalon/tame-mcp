import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createSessionClient } from "../../../lib/supabase";
import { afterSignIn, authorizationIdFrom } from "../../oauth/consent/path";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = authorizationIdFrom(params.get("authorization_id"));
  const failed = id ? `/login?authorization_id=${id}&error=google` : "/login?error=google";
  const code = params.get("code");
  if (!code || code.length > 2048) redirect(failed);
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  redirect(error ? failed : afterSignIn(id));
}
