import Link from "next/link";
import { getCore } from "../../lib/core";
import { mcpResourceUrl, publicConfig } from "../../lib/env";
import { requireUser } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireUser();
  const core = getCore();
  const [collections, profiles] = await Promise.all([
    core.collections.list(user.id),
    core.profiles.list(user.id),
  ]);
  const documentCount = collections.reduce((total, collection) => total + collection.documentCount, 0);

  return (
    <>
      <h1>Overview</h1>

      <section aria-labelledby="summary">
        <h2 id="summary">Summary</h2>
        <dl className="stats">
          <div>
            <dt>Collections</dt>
            <dd>{collections.length}</dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>{documentCount}</dd>
          </div>
          <div>
            <dt>Profiles</dt>
            <dd>{profiles.length}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="start">
        <h2 id="start">Getting started</h2>
        <ol>
          <li>
            <Link href="/collections">Create a collection</Link> and upload a few examples of one kind of
            document.
          </li>
          <li>Connect your agent with the server address below.</li>
          <li>Ask your agent to make a TAME profile from the collection, review it, and confirm.</li>
          <li>Next time, ask your agent to write the document with TAME.</li>
        </ol>
      </section>

      <section aria-labelledby="connect">
        <h2 id="connect">Connect an agent</h2>
        <p>
          MCP server: <code>{mcpResourceUrl(publicConfig())}</code>
        </p>
        <p>Add it in Codex or Claude Code. A browser window opens to sign in the first time.</p>
      </section>

      {profiles.length > 0 && (
        <section aria-labelledby="recent">
          <h2 id="recent">Profiles</h2>
          <ul>
            {profiles.map((profile) => (
              <li key={profile.id}>
                <Link href={`/profiles/${profile.id}`}>{profile.name}</Link> (v{profile.versionNumber})
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
