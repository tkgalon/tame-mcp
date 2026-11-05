import { requireUser } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";
import { ConnectionsView } from "./view";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });

export default async function ConnectionsPage() {
  await requireUser();
  const supabase = await createSessionClient({ readOnly: true });
  const { data: grants, error } = await supabase.auth.oauth.listGrants();
  return (
    <ConnectionsView
      connections={
        error
          ? null
          : grants.map((grant) => ({
              clientId: grant.client.id,
              name: grant.client.name || "MCP client",
              connected: when.format(new Date(grant.granted_at)),
            }))
      }
    />
  );
}
