import { redirect } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { Landing } from "../components/landing/landing";
import { getCore } from "../lib/core";
import { mcpResourceUrl, publicConfig } from "../lib/env";
import { getUser, hasAccess } from "../lib/session";
import { createSessionClient } from "../lib/supabase";
import { OverviewView } from "./_overview/view";

export const dynamic = "force-dynamic";

// Visitors get the landing page, approved accounts get their overview at the same address
export default async function HomePage() {
  const mcpUrl = mcpResourceUrl(publicConfig());
  const user = await getUser();
  if (!user) return <Landing mcpUrl={mcpUrl} />;
  if (!(await hasAccess(user.id))) redirect("/pending");

  const core = getCore();
  const supabase = await createSessionClient({ readOnly: true });
  const [collections, profiles, grants] = await Promise.all([
    core.collections.list(user.id),
    core.profiles.list(user.id),
    supabase.auth.oauth.listGrants(),
  ]);

  return (
    <AppShell email={user.email ?? ""}>
      <OverviewView
        collections={collections.length}
        documents={collections.reduce((total, collection) => total + collection.documentCount, 0)}
        profiles={profiles}
        connected={(grants.data?.length ?? 0) > 0}
        mcpUrl={mcpUrl}
      />
    </AppShell>
  );
}
