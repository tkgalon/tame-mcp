"use server";

import { redirect } from "next/navigation";
import { publicConfig } from "../../lib/env";
import { createSessionClient } from "../../lib/supabase";
import { authorizationIdFrom } from "../oauth/consent/path";

export async function signInWithGoogle(form: FormData): Promise<void> {
  const id = authorizationIdFrom(form.get("authorizationId"));
  const callback = new URL("/auth/callback", publicConfig().siteUrl);
  if (id) callback.searchParams.set("authorization_id", id);
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });
  if (error || !data.url) redirect(id ? `/login?authorization_id=${id}&error=google` : "/login?error=google");
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
