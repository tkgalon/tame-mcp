import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { getUser } from "../../lib/session";
import { afterSignIn, authorizationIdFrom } from "../oauth/consent/path";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const id = authorizationIdFrom((await searchParams).authorization_id);
  if (await getUser()) redirect(afterSignIn(id));
  return (
    <main>
      <h1>TAME</h1>
      <p>Teach Agents My Examples</p>
      <AuthForm mode="sign-in" authorizationId={id} />
      <p>
        <Link href={id ? `/signup?authorization_id=${id}` : "/signup"}>Create an account</Link>
      </p>
    </main>
  );
}
