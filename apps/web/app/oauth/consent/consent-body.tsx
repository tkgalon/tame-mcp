"use client";

import { useFormStatus } from "react-dom";

type Props = { clientName: string; email: string; redirectUri: string; error: boolean };

function LinkArt({ on }: { on: boolean }) {
  const led = on ? "var(--acc)" : "#3A3D42";
  return (
    <div className="link-art rise">
      <span className="node agent">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M7 10l3 2.5L7 15M12.5 15H17" strokeLinecap="round" />
        </svg>
      </span>
      <span className={on ? "wire on" : "wire"} aria-hidden="true" />
      <span className="node tame">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="7" width="14" height="8" rx="3" fill="#0E0F10" />
          <rect x="8" y="9.5" width="2.4" height="3.4" rx="1.2" fill={led} />
          <rect x="13.6" y="9.5" width="2.4" height="3.4" rx="1.2" fill={led} />
        </svg>
      </span>
    </div>
  );
}

export function UnavailableBody() {
  return (
    <>
      <LinkArt on={false} />
      <div className="rise d1" style={{ display: "grid", gap: 8 }}>
        <h1>
          Connection <span className="tone">unavailable</span>
        </h1>
        <p className="lead" style={{ fontSize: 17 }}>
          This request is invalid or expired. Start the connection again from your agent.
        </p>
      </div>
    </>
  );
}

// Lives inside the consent form, so the chosen button shows its outcome while the redirect runs
export function ConsentBody({ clientName, email, redirectUri, error }: Props) {
  const { pending, data } = useFormStatus();
  const decision = pending ? data?.get("decision") : null;
  return (
    <>
      <LinkArt on={decision === "approve"} />
      <div className="rise d1" style={{ display: "grid", gap: 8 }}>
        <h1>
          Connect <span className="tone">to TAME</span>
        </h1>
        <p className="lead" style={{ fontSize: 17 }}>
          <b style={{ color: "var(--text)" }}>{clientName}</b> wants to use your TAME profiles and examples as{" "}
          <span className="code">{email}</span>.
        </p>
      </div>
      <div className="card rise d2">
        {decision === "approve" ? (
          <div className="decided fade" role="status">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="18" fill="var(--ok-soft)" />
              <path
                d="M12 20.5l5.5 5.5L28.5 15"
                fill="none"
                stroke="var(--ok)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h2>{clientName} is connected</h2>
            <p className="small">Returning to {clientName}. You can close this tab.</p>
          </div>
        ) : decision === "deny" ? (
          <div className="decided fade" role="status">
            <h2>Request denied</h2>
            <p className="small">
              {clientName} did not get access. Start again from your agent if this was a mistake.
            </p>
          </div>
        ) : (
          <>
            {error && (
              <p className="alert" role="alert">
                Unable to complete the request. Try again.
              </p>
            )}
            <p className="lbl">{clientName} will be able to</p>
            <ul className="perm">
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 3h8l5 5v13H6z" />
                  <path d="M14 3v5h5" />
                </svg>
                <span>Read your example documents and profiles</span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
                <span>Save profile drafts and publish them when you confirm in chat</span>
              </li>
            </ul>
            <p className="small">
              After approval you return to <span className="code">{redirectUri}</span>. You can revoke access
              on the Connections page.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button className="btn" type="submit" name="decision" value="deny">
                Deny
              </button>
              <button className="btn p" type="submit" name="decision" value="approve">
                Allow
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
