"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "../../../lib/auth/session";
import { readAuthConfig } from "../../../lib/auth/config";
import { authorizationId, consentPath } from "../../../lib/oauth/schema";
import { decideConsent } from "../../../lib/oauth/consent";

export async function consentAction(form: FormData): Promise<never> {
  const id = authorizationId(form.get("authorizationId"));
  if (!id) redirect("/oauth/consent?error=unavailable");
  const config = readAuthConfig();
  const decision = form.get("decision");
  if (!config || (await headers()).get("origin") !== config.siteUrl || !["approve", "deny"].includes(String(decision))) {
    redirect(`${consentPath(id)}&error=unavailable`);
  }
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/login?authorization_id=${id}`);
  let destination: string | null = null;
  try { destination = await decideConsent(user.id, id, decision === "approve"); } catch {}
  redirect(destination ?? `${consentPath(id)}&error=unavailable`);
}
