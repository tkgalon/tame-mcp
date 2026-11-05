import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";
import { ProfilesView } from "./view";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const user = await requireUser();
  const core = getCore();
  const [profiles, drafts] = await Promise.all([
    core.profiles.list(user.id),
    core.profiles.listDrafts(user.id),
  ]);
  return <ProfilesView profiles={profiles} drafts={drafts.map(({ id, name }) => ({ id, name }))} />;
}
