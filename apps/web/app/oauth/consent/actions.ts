"use server";

import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";
import { authorizationIdFrom } from "./path";

export async function decideConsent(form: FormData): Promise<void> {
  await requireUser();
  const id = authorizationIdFrom(form.get("authorizationId"));
  if (!id) redirect("/oauth/consent?error=unavailable");

  const supabase = await createSessionClient();
  const decide =
    form.get("decision") === "approve"
      ? supabase.auth.oauth.approveAuthorization
      : supabase.auth.oauth.denyAuthorization;
  const { data, error } = await decide.call(supabase.auth.oauth, id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect(`/oauth/consent?authorization_id=${id}&error=unavailable`);
  redirect(data.redirect_url);
}
