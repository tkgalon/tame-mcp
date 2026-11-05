import Link from "next/link";
import { CopyButton } from "../../components/copy-button";
import { Sig } from "../../components/sig";

export type OverviewData = {
  collections: number;
  documents: number;
  profiles: { id: string; name: string; description: string; versionNumber: number }[];
  connected: boolean;
  mcpUrl: string;
};

const STEPS = [
  <>
    <Link href="/collections">Create a collection</Link> and upload a few examples of one kind of document.
  </>,
  <>Connect your agent with the server address below.</>,
  <>Ask your agent to make a TAME profile from the collection, review it, and confirm.</>,
  <>Next time, ask your agent to write the document with TAME.</>,
];

export function OverviewView({ collections, documents, profiles, connected, mcpUrl }: OverviewData) {
  const done = [documents > 0, connected, profiles.length > 0, false];
  const doneCount = done.filter(Boolean).length;
  return (
    <>
      <div className="ph rise">
        <div>
          <h1>Overview</h1>
          <p className="lead">Your examples, the profiles made from them, and the agents that use them.</p>
        </div>
      </div>

      <dl className="grid3 rise d1">
        <div className="card stat">
          <dt>Collections</dt>
          <dd>{collections}</dd>
        </div>
        <div className="card stat">
          <dt>Documents</dt>
          <dd>{documents}</dd>
        </div>
        <div className="card stat">
          <dt>Profiles</dt>
          <dd>{profiles.length}</dd>
        </div>
      </dl>

      <div className="grid2">
        <div className="stack">
          <section className="card rise d2" aria-labelledby="start">
            <div className="card-h">
              <h2 id="start">Getting started</h2>
              <span className="badge acc plain">{doneCount} of 4 done</span>
            </div>
            <div className="card-b">
              <ol className="steps">
                {STEPS.map((step, index) => (
                  <li key={index} className={done[index] ? "done" : undefined}>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="card rise d3" aria-labelledby="connect">
            <div className="card-h">
              <h2 id="connect">Connect an agent</h2>
              <span className="small">A browser window opens to sign in the first time.</span>
            </div>
            <div className="card-b stack" style={{ gap: 14 }}>
              <div className="lbl">MCP server</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code
                  className="input code"
                  style={{
                    display: "block",
                    flex: 1,
                    minWidth: 0,
                    lineHeight: "42px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {mcpUrl}
                </code>
                <CopyButton text={mcpUrl} />
              </div>
              <div className="term">
                <span className="c"># Codex</span>
                <br />
                <span className="a">$</span> codex mcp add tame --url …/mcp
                <br />
                <span className="c"># Claude Code</span>
                <br />
                <span className="a">$</span> claude mcp add --transport http tame …/mcp
              </div>
            </div>
          </section>
        </div>

        <section className="card rise d3" aria-labelledby="recent">
          <div className="card-h">
            <h2 id="recent">Profiles</h2>
            <Link className="btn sm" href="/profiles">
              All profiles
            </Link>
          </div>
          {profiles.length > 0 && (
            <div className="tbl-wrap">
              <table>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="row-link">
                      <td>
                        <Link href={`/profiles/${profile.id}`} style={{ fontWeight: 600 }}>
                          {profile.name}
                        </Link>
                        <div className="small">{profile.description}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Sig tone="ok">v{profile.versionNumber} active</Sig>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            className="card-b"
            style={profiles.length > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
          >
            <p className="small">
              Profiles are created and changed from your agent. Ask it to make one from a collection.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
