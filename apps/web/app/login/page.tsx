import { redirect } from "next/navigation";
import { getUser } from "../../lib/session";
import { afterSignIn, authorizationIdFrom } from "../oauth/consent/path";
import { LoginView } from "./view";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const params = await searchParams;
  const id = authorizationIdFrom(params.authorization_id);
  if (await getUser()) redirect(afterSignIn(id));
  return <LoginView authorizationId={id ?? null} error={Boolean(params.error)} />;
}
