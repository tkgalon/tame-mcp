import { ConfirmForm } from "../../../components/confirm-form";
import { requireUser } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";
import { revokeConnection } from "./actions";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  await requireUser();
  const supabase = await createSessionClient({ readOnly: true });
  const { data: grants, error } = await supabase.auth.oauth.listGrants();
  return (
    <>
      <h1>Connections</h1>
      <p>Agents you approved to use TAME. Revoking stops access on the next request.</p>
      {error ? (
        <p role="alert">Unable to load connected apps. Refresh to try again.</p>
      ) : grants.length === 0 ? (
        <p>No apps are connected.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">App</th>
              <th scope="col">Connected</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.client.id}>
                <td>{grant.client.name || "MCP client"}</td>
                <td>{new Date(grant.granted_at).toLocaleString("en-GB")}</td>
                <td>
                  <ConfirmForm
                    action={revokeConnection}
                    fields={{ clientId: grant.client.id }}
                    label="Revoke"
                    warning="Disconnect this app. Chats it already has keep their content."
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
