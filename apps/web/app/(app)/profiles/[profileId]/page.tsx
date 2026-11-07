import { notFound } from "next/navigation";
import { z } from "zod";
import { TameError } from "@tame/core";
import { PROFILE_TABS } from "../../../../lib/profile-tabs";
import { getCore } from "../../../../lib/core";
import { requireUser } from "../../../../lib/session";
import { ProfileView } from "./view";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { profileId } = await params;
  if (!z.uuid().safeParse(profileId).success) notFound();
  const requested = (await searchParams).tab;
  const tab = PROFILE_TABS.find((name) => name === requested) ?? "overview";

  const core = getCore();
  const [profile, history] = await Promise.all([
    core.profiles.export(user.id, profileId),
    core.profiles.history(user.id, { profileId }),
  ]).catch((error: unknown) => {
    if (error instanceof TameError) notFound();
    throw error;
  });

  return (
    <ProfileView
      profileId={profileId}
      versionNumber={profile.versionNumber}
      payload={profile.payload}
      versions={"versions" in history ? history.versions : []}
      tab={tab}
    />
  );
}
