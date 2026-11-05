import Link from "next/link";
import { DraftList } from "../../../components/draft-list";
import { Sig } from "../../../components/sig";

type Props = {
  profiles: { id: string; name: string; description: string; versionNumber: number }[];
  drafts: { id: string; name: string }[];
};

export function ProfilesView({ profiles, drafts }: Props) {
  return (
    <>
      <div className="ph rise">
        <div>
          <h1>Profiles</h1>
          <p className="lead">
            Profiles are created and changed from your agent. Open one to review it, export it or delete it.
          </p>
        </div>
      </div>

      <section className="card rise d1" aria-labelledby="active">
        <div className="card-h">
          <h2 id="active">Active profiles</h2>
        </div>
        {profiles.length === 0 ? (
          <div className="empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="3" width="14" height="18" rx="3" />
              <path d="M9 8h6M9 12h6M9 16h3" strokeLinecap="round" />
            </svg>
            <h3>No profiles yet</h3>
            <p className="small">Ask your agent to create one from a collection.</p>
            <div className="term" style={{ textAlign: "left" }}>
              <span className="a">›</span> make a TAME profile from my Reports collection
            </div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="hide-sm">
                    Description
                  </th>
                  <th scope="col">Version</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="row-link">
                    <td>
                      <Link href={`/profiles/${profile.id}`} style={{ fontWeight: 600 }}>
                        {profile.name}
                      </Link>
                    </td>
                    <td className="hide-sm muted">{profile.description}</td>
                    <td>
                      <Sig tone="ok">v{profile.versionNumber}</Sig>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="btn sm" href={`/profiles/${profile.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rise d2" aria-labelledby="drafts">
        <div className="card-h">
          <h2 id="drafts">Unpublished drafts</h2>
          <span className="small">Drafts change nothing until you confirm them in chat.</span>
        </div>
        {drafts.length === 0 ? (
          <div className="empty">
            <p className="small">No unpublished drafts.</p>
          </div>
        ) : (
          <DraftList drafts={drafts} />
        )}
      </section>
    </>
  );
}
