import Link from "next/link";
import type { ReactNode } from "react";
import type { ProfilePayload } from "@tame/contracts";
import { ConfirmForm } from "../../../../components/confirm";
import { ProfileTabs } from "../../../../components/profile-tabs";
import type { ProfileTab } from "../../../../lib/profile-tabs";
import { Sig } from "../../../../components/sig";
import { deleteProfile } from "../actions";

type Version = {
  versionId: string;
  versionNumber: number;
  active: boolean;
  reason: string | null;
  createdAt: Date;
};

type Props = {
  profileId: string;
  versionNumber: number;
  payload: ProfilePayload;
  versions: Version[];
  tab: ProfileTab;
};

const STRENGTH = { required: "must", preferred: "should", optional: "optional" } as const;
const ORIGIN = {
  inferred: "evidence",
  user_stated: "you",
  product_default: "default",
  unconfirmed: "unconfirmed",
} as const;

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });

function Download() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v9M4 7l4 4 4-4M3 14h10" />
    </svg>
  );
}

// Typst keywords in grey and strings in the accent, like the landing code panes
function highlight(source: string): ReactNode[] {
  return source.split(/(#[a-z]+|"[^"\n]*")/g).map((part, index) => {
    if (part.startsWith("#") && /^#[a-z]+$/.test(part))
      return (
        <span key={index} className="k">
          {part}
        </span>
      );
    if (part.startsWith('"'))
      return (
        <span key={index} className="s">
          {part}
        </span>
      );
    return part;
  });
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="bul">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function ProfileView({ profileId, versionNumber, payload, versions, tab }: Props) {
  const format = payload.output.format;
  const quoted = new Set(payload.evidence.map((item) => item.ruleId));
  const fromChat = payload.rules.filter((rule) => rule.origin === "user_stated" && !quoted.has(rule.id));
  const panels: Record<ProfileTab, ReactNode> = {
    overview: (
      <div className="tabbody fade">
        <p style={{ fontSize: 17 }}>{payload.description}</p>
        <div className="grid2">
          <div className="stack" style={{ gap: 10 }}>
            <h2>When to use</h2>
            <Bullets items={payload.whenToUse} />
          </div>
          {payload.whenNotToUse.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              <h2>When not to use</h2>
              <Bullets items={payload.whenNotToUse} />
            </div>
          )}
        </div>
        <div className="grid2">
          <div className="stack" style={{ gap: 10 }}>
            <h2>Output</h2>
            <dl className="kvs">
              <div>
                <dt>Format</dt>
                <dd>{format}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>{payload.output.template ? "set" : "none yet"}</dd>
              </div>
            </dl>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <h2>Export</h2>
            <div className="exp">
              <a className="btn" href={`/profiles/${profileId}/export?format=json`}>
                <Download />
                Download JSON
              </a>
              <a className="btn" href={`/profiles/${profileId}/export?format=markdown`}>
                <Download />
                Download Markdown
              </a>
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 10, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
          <h2 style={{ paddingTop: 14 }}>Delete</h2>
          <ConfirmForm
            action={deleteProfile}
            fields={{ id: profileId }}
            label="Delete profile"
            message="Delete this profile with all versions and drafts. Source documents stay."
          />
        </div>
      </div>
    ),
    structure:
      payload.structure.length === 0 ? (
        <p className="muted fade">No sections defined.</p>
      ) : (
        <div className="fade">
          {payload.structure.map((section, index) => (
            <div key={section.title} className="sect">
              <span className="n">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{section.title}</b>
                <span className="muted">{section.guidance}</span>
              </div>
              <span className={section.required ? "badge ok plain" : "badge plain"}>
                {section.required ? "required" : "optional"}
              </span>
            </div>
          ))}
        </div>
      ),
    rules: (
      <div className="tbl-wrap fade" style={{ margin: -22 }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Category</th>
              <th scope="col">Strength</th>
              <th scope="col">Origin</th>
            </tr>
          </thead>
          <tbody>
            {payload.rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.instruction}</td>
                <td>{rule.category}</td>
                <td>
                  <span className={rule.strength === "required" ? "badge acc plain" : "badge plain"}>
                    {STRENGTH[rule.strength]}
                  </span>
                </td>
                <td>{ORIGIN[rule.origin]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    evidence: (
      <div className="stack fade" style={{ gap: 12 }}>
        {payload.evidence.length === 0 && (
          <p className="small">No evidence. All rules come from you or the product defaults.</p>
        )}
        {payload.evidence.map((item, index) => (
          <figure key={index} className="quote">
            <blockquote>{item.excerpt}</blockquote>
            <figcaption>Supports {item.ruleId}</figcaption>
          </figure>
        ))}
        {payload.evidence.length > 0 &&
          fromChat.map((rule) => (
            <p key={rule.id} className="small">
              {rule.id} has no quote. It came from you in chat.
            </p>
          ))}
      </div>
    ),
    template: payload.output.template ? (
      <div className="stack fade" style={{ gap: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <p className="muted">Typst template your agent compiles the {format.toUpperCase()} with.</p>
          <a className="btn" href={`/profiles/${profileId}/template`}>
            Download template.typ
          </a>
        </div>
        <div className="cw">
          <div className="cw-bar">
            <span>template.typ</span>
            <span>
              {payload.name} v{versionNumber}
            </span>
          </div>
          <pre className="cb">{highlight(payload.output.template)}</pre>
        </div>
      </div>
    ) : (
      <p className="muted fade">
        No template yet. Ask your agent to build one from your examples, for example &quot;use TAME to build a
        template for {payload.name} from my examples&quot;.
      </p>
    ),
    history: (
      <div className="fade" style={{ display: "grid", gap: 14 }}>
        <div className="tbl-wrap" style={{ margin: "-22px -22px 0" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Reason</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.versionId}>
                  <td>
                    {version.active ? (
                      <Sig tone="ok">v{version.versionNumber} active</Sig>
                    ) : (
                      <span className="badge plain">v{version.versionNumber}</span>
                    )}
                  </td>
                  <td>{version.reason ?? "First version"}</td>
                  <td className="small">{when.format(version.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          Ask your agent to roll back if an older version was better. A rollback adds a new version.
        </p>
      </div>
    ),
  };

  return (
    <>
      <div className="ph rise">
        <div>
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/profiles">Profiles</Link>
            <i>/</i>
            {payload.name}
          </nav>
          <h1>
            {payload.name}
            <span className="ver">v{versionNumber}</span>
          </h1>
        </div>
        <Sig tone="ok" chip>
          Active, approved by you
        </Sig>
      </div>
      <ProfileTabs initial={tab} panels={panels} />
    </>
  );
}
