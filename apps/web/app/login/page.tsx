import { redirect } from "next/navigation";
import { getUser } from "../../lib/session";
import { signInWithGoogle } from "../auth/actions";
import { afterSignIn, authorizationIdFrom } from "../oauth/consent/path";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const params = await searchParams;
  const id = authorizationIdFrom(params.authorization_id);
  if (await getUser()) redirect(afterSignIn(id));
  return (
    <main>
      <h1>TAME</h1>
      <p>Teach Agents My Examples</p>
      <form action={signInWithGoogle}>
        {id && <input type="hidden" name="authorizationId" value={id} />}
        <button type="submit">Continue with Google</button>
      </form>
      <p>A new account is created the first time you sign in.</p>
      {params.error && <p role="alert">Unable to sign in with Google. Try again.</p>}
    </main>
  );
}
