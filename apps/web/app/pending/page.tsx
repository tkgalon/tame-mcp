import { redirect } from "next/navigation";
import { getUser, hasAccess } from "../../lib/session";
import { PendingView } from "./view";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (await hasAccess(user.id)) redirect("/");
  return <PendingView email={user.email ?? ""} />;
}
