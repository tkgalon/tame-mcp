import { requireUser } from "../lib/auth/session";
import { SignOutForm } from "../components/sign-out-form";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <main>
      <h1>TAME-MCP</h1>
      <p>Signed in as {user.email ?? "your account"}.</p>
      <p>Document collections and task profiles are not available yet.</p>
      <SignOutForm />
    </main>
  );
}
