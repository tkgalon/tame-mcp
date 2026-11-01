import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { AuthSetup } from "../../components/auth-setup";
import { readAuthConfig } from "../../lib/auth/config";
import { getAuthenticatedUser } from "../../lib/auth/session";

import { authorizationId, consentPath } from "../../lib/oauth/schema";

export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const id = authorizationId((await searchParams).authorization_id);
  const configured = Boolean(readAuthConfig());
  if (configured && await getAuthenticatedUser()) redirect(consentPath(id));
  return (
    <main>
      <h1>TAME-MCP</h1>
      {configured ? <AuthForm mode="sign-up" authorizationId={id ?? undefined} /> : <AuthSetup />}
      <p><Link href={id ? `/login?authorization_id=${id}` : "/login"}>Back to sign in</Link></p>
    </main>
  );
}
