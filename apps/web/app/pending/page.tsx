import { redirect } from "next/navigation";
import { getUser, hasAccess } from "../../lib/session";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (await hasAccess(user.id)) redirect("/");
  return (
    <main>
      <h1>Access not approved yet</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>, but this account cannot use TAME yet.
      </p>
      <p>Ask the TAME owner to approve this email, then reload this page.</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
