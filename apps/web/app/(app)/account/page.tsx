import { requireUser } from "../../../lib/session";
import { AccountView } from "./view";

export const dynamic = "force-dynamic";

const PROVIDERS: Record<string, string> = { google: "Google", email: "Email" };

export default async function AccountPage() {
  const user = await requireUser();
  const provider = String(user.app_metadata["provider"] ?? "");
  return <AccountView email={user.email ?? ""} provider={PROVIDERS[provider] ?? provider} />;
}
