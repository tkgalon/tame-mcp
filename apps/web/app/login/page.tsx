import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { AuthSetup } from "../../components/auth-setup";
import { readAuthConfig } from "../../lib/auth/config";
import { getAuthenticatedUser } from "../../lib/auth/session";

import { authorizationId, consentPath } from "../../lib/oauth/schema";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; authorization_id?: string }> }) {
  const configured = Boolean(readAuthConfig());
  const params = await searchParams;
  const id = authorizationId(params.authorization_id);
  if (configured && await getAuthenticatedUser()) redirect(consentPath(id));
  return (
    <main>
      <h1>TAME-MCP</h1>
      <p>Teach Agents My Examples</p>
      {params.error === "confirmation" && <p role="alert">The confirmation link is invalid or expired. Try signing in or create an account if needed.</p>}
      {configured ? (
        <>
          <AuthForm mode="sign-in" authorizationId={id ?? undefined} />
          <p><Link href={id ? `/signup?authorization_id=${id}` : "/signup"}>Create an account</Link></p>
        </>
      ) : <AuthSetup />}
    </main>
  );
}
