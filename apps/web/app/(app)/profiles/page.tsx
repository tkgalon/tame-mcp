import Link from "next/link";
import { ConfirmForm } from "../../../components/confirm-form";
import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";
import { deleteDraft } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const user = await requireUser();
  const core = getCore();
  const [profiles, drafts] = await Promise.all([
    core.profiles.list(user.id),
    core.profiles.listDrafts(user.id),
  ]);
  return (
    <>
      <h1>Profiles</h1>
      <p>Profiles are created and changed from your agent. Open one to review it, export it or delete it.</p>

      <section aria-labelledby="active">
        <h2 id="active">Active profiles</h2>
        {profiles.length === 0 ? (
          <p>No profiles yet. Ask your agent to create one from a collection.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
                <th scope="col">Version</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <Link href={`/profiles/${profile.id}`}>{profile.name}</Link>
                  </td>
                  <td>{profile.description}</td>
                  <td>v{profile.versionNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="drafts">
        <h2 id="drafts">Unpublished drafts</h2>
        {drafts.length === 0 ? (
          <p>No unpublished drafts.</p>
        ) : (
          <ul>
            {drafts.map((draft) => (
              <li key={draft.id}>
                <p>
                  {draft.name} (draft <code>{draft.id}</code>)
                </p>
                <ConfirmForm
                  action={deleteDraft}
                  fields={{ id: draft.id }}
                  label="Delete draft"
                  warning="Delete this unpublished draft."
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
