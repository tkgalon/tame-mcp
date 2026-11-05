import { redirect } from "next/navigation";
import { getUser, hasAccess } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";
import { authorizationIdFrom } from "./path";
import { ConsentView, UnavailableView } from "./view";

export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const params = await searchParams;
  const id = authorizationIdFrom(params.authorization_id);
  if (!id) return <UnavailableView />;
  const user = await getUser();
  if (!user) redirect(`/login?authorization_id=${id}`);
  if (!(await hasAccess(user.id))) redirect("/pending");

  const supabase = await createSessionClient({ readOnly: true });
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <UnavailableView />;
  // Supabase skips the question for an app the user already approved
  if ("redirect_url" in data) redirect(data.redirect_url);

  return (
    <ConsentView
      authorizationId={id}
      clientName={data.client.name || "An MCP client"}
      email={data.user.email}
      redirectUri={data.redirect_uri}
      error={Boolean(params.error)}
    />
  );
}
