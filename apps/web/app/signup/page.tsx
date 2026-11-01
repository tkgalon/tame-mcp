import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { AuthSetup } from "../../components/auth-setup";
import { readAuthConfig } from "../../lib/auth/config";
import { getAuthenticatedUser } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const configured = Boolean(readAuthConfig());
  if (configured && await getAuthenticatedUser()) redirect("/");
  return (
    <main>
      <h1>TAME-MCP</h1>
      {configured ? <AuthForm mode="sign-up" /> : <AuthSetup />}
      <p><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
