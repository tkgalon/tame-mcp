import { redirect } from "next/navigation";
import { getUser } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";
import { decideConsent } from "./actions";
import { authorizationIdFrom } from "./path";

export const dynamic = "force-dynamic";

const unavailable = (
  <main>
    <h1>Connection unavailable</h1>
    <p>This request is invalid or expired. Start the connection again from your agent.</p>
  </main>
);

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const params = await searchParams;
  const id = authorizationIdFrom(params.authorization_id);
  if (!id) return unavailable;
  if (!(await getUser())) redirect(`/login?authorization_id=${id}`);

  const supabase = await createSessionClient({ readOnly: true });
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return unavailable;
  // Supabase skips the question for an app the user already approved
  if ("redirect_url" in data) redirect(data.redirect_url);

  return (
    <main>
      <h1>Connect to TAME</h1>
      <p>
        <strong>{data.client.name || "An MCP client"}</strong> wants to use your TAME profiles and examples as{" "}
        {data.user.email}.
      </p>
      <ul>
        <li>Read your example documents and profiles</li>
        <li>Save profile drafts and publish them when you confirm in chat</li>
      </ul>
      <p>
        After approval you return to <code>{data.redirect_uri}</code>. You can revoke access on the
        Connections page.
      </p>
      {params.error && <p role="alert">Unable to complete the request. Try again.</p>}
      <form action={decideConsent}>
        <input type="hidden" name="authorizationId" value={id} />
        <button type="submit" name="decision" value="approve">
          Allow
        </button>{" "}
        <button type="submit" name="decision" value="deny">
          Deny
        </button>
      </form>
    </main>
  );
}
