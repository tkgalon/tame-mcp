import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "../../../lib/auth/session";
import { authorizationId } from "../../../lib/oauth/schema";
import { getConsentContext } from "../../../lib/oauth/consent";
import { consentAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string; error?: string }> }) {
  const params = await searchParams;
  const id = authorizationId(params.authorization_id);
  if (!id) return <main><h1>Connection unavailable</h1><p>Restart the connection from your agent.</p></main>;
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/login?authorization_id=${id}`);
  let context;
  try { context = await getConsentContext(user.id, id); } catch {}
  if (!context) return <main><h1>Connection unavailable</h1><p>This request is unavailable or expired. Restart the connection from your agent.</p></main>;
  return <main>
    <h1>Connect to TAME-MCP</h1>
    <p>Signed in as {user.email}</p>
    <p><strong>{context.client_name || "Registered MCP client"}</strong> is requesting access to your TAME account.</p>
    <p>Resource: <code>{context.resource_url}</code></p>
    <ul><li>Read your uploaded examples</li><li>Read your task profiles</li><li>Create and update your task profiles</li></ul>
    <p>Identity scopes requested: {context.scope}</p>
    {params.error && <p role="alert">Unable to complete this request. Try again or restart the connection from your agent.</p>}
    <form action={consentAction}>
      <input type="hidden" name="authorizationId" value={id} />
      <button type="submit" name="decision" value="approve">Allow access</button>{" "}
      <button type="submit" name="decision" value="deny">Deny</button>
    </form>
  </main>;
}
