import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { getUser } from "../../lib/session";
import { afterSignIn, authorizationIdFrom } from "../oauth/consent/path";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const id = authorizationIdFrom((await searchParams).authorization_id);
  if (await getUser()) redirect(afterSignIn(id));
  return (
    <main>
      <h1>TAME</h1>
      <AuthForm mode="sign-up" authorizationId={id} />
      <p>
        <Link href={id ? `/login?authorization_id=${id}` : "/login"}>Back to sign in</Link>
      </p>
    </main>
  );
}
