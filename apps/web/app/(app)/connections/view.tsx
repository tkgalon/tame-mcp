import { ConnectionTable } from "../../../components/connection-table";
import type { Connection } from "../../../components/connection-table";

export function ConnectionsView({ connections }: { connections: Connection[] | null }) {
  return (
    <>
      <div className="ph rise">
        <div>
          <h1>Connections</h1>
          <p className="lead">Agents you approved to use TAME. Revoking stops access on the next request.</p>
        </div>
      </div>

      <section className="card rise d1" aria-labelledby="apps">
        <div className="card-h">
          <h2 id="apps">Connected apps</h2>
          {connections && (
            <span className="small">
              {connections.length} {connections.length === 1 ? "app" : "apps"}
            </span>
          )}
        </div>
        {connections === null ? (
          <div className="card-b">
            <p className="alert" role="alert">
              Unable to load connected apps. Refresh to try again.
            </p>
          </div>
        ) : connections.length === 0 ? (
          <div className="empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M7 10l3 2.5L7 15M12.5 15H17" strokeLinecap="round" />
            </svg>
            <h3>No apps are connected</h3>
            <p className="small">
              Add the MCP server in Codex or Claude Code. A browser window opens to sign in the first time.
            </p>
          </div>
        ) : (
          <ConnectionTable connections={connections} />
        )}
      </section>
    </>
  );
}
