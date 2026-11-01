import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import { ApiError } from "../http/api";
import { authorizationIdSchema, callbackFor, consentContextSchema } from "./schema";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export async function getConsentContext(ownerId: string, id: string, client?: Client) {
  const authorizationId = authorizationIdSchema.parse(id);
  const supabase = client ?? await createSupabaseServerClient({ readOnly: true });
  const { data, error } = await supabase.rpc("get_mcp_oauth_authorization", { p_authorization_id: authorizationId });
  if (error) throw new ApiError(error.code === "P0002" ? 404 : 502, "authorization_unavailable", "The authorization request is unavailable or expired.");
  const parsed = consentContextSchema.safeParse(data);
  if (!parsed.success || parsed.data.authorization_id !== authorizationId
    || (parsed.data.user_id !== null && parsed.data.user_id !== ownerId)) {
    throw new ApiError(502, "authorization_unavailable", "The authorization service returned an invalid response.");
  }
  return parsed.data;
}
export async function decideConsent(ownerId: string, id: string, approve: boolean): Promise<string> {
  const supabase = await createSupabaseServerClient();
  let context = await getConsentContext(ownerId, id, supabase);
  if (context.status === "pending") {
    const details = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (details.error) throw new ApiError(502, "authorization_unavailable", "Unable to load provider authorization.");
    context = await getConsentContext(ownerId, id, supabase);
  }
  if (context.user_id !== ownerId) throw new ApiError(403, "forbidden", "This request belongs to another session.");
  if (approve) {
    if (context.status === "pending") {
      const result = await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true });
      if (result.error) throw new ApiError(502, "authorization_unavailable", "Provider approval failed.");
    }
    const saved = await supabase.rpc("approve_mcp_oauth_consent", { p_authorization_id: id });
    if (saved.error || saved.data !== true) throw new ApiError(502, "authorization_unavailable", "Unable to save application consent.");
    return callbackFor(await getConsentContext(ownerId, id, supabase), true);
  }
  if (context.status === "pending") {
    const result = await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (result.error) throw new ApiError(502, "authorization_unavailable", "Unable to deny provider authorization.");
  }
  return callbackFor(context, false);
}
