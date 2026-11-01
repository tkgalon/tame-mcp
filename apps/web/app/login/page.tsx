import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { AuthSetup } from "../../components/auth-setup";
import { readAuthConfig } from "../../lib/auth/config";
import { getAuthenticatedUser } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const configured = Boolean(readAuthConfig());
  if (configured && await getAuthenticatedUser()) redirect("/");
  const params = await searchParams;
  return (
    <main>
      <h1>TAME-MCP</h1>
      <p>Teach Agents My Examples</p>
      {params.error === "confirmation" && <p role="alert">The confirmation link is invalid or expired. Try signing in or create an account if needed.</p>}
      {configured ? (
        <>
          <AuthForm mode="sign-in" />
          <p><Link href="/signup">Create an account</Link></p>
        </>
      ) : <AuthSetup />}
    </main>
  );
}
