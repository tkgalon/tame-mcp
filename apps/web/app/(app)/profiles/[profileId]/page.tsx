import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TameError } from "@tame/core";
import { ConfirmForm } from "../../../../components/confirm-form";
import { getCore } from "../../../../lib/core";
import { requireUser } from "../../../../lib/session";
import { deleteProfile } from "../actions";

export const dynamic = "force-dynamic";

const TABS = ["overview", "structure", "rules", "evidence", "template", "history"] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  overview: "Overview",
  structure: "Structure",
  rules: "Rules",
  evidence: "Evidence",
  template: "Template",
  history: "History",
};

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { profileId } = await params;
  if (!z.uuid().safeParse(profileId).success) notFound();
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.find((name) => name === requested) ?? "overview";

  const core = getCore();
  const profile = await core.profiles.export(user.id, profileId).catch((error: unknown) => {
    if (error instanceof TameError) notFound();
    throw error;
  });
  const history = tab === "history" ? await core.profiles.history(user.id, { profileId }) : null;
  const { payload } = profile;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/profiles">Profiles</Link> / {payload.name}
      </nav>
      <h1>
        {payload.name} <small>v{profile.versionNumber}</small>
      </h1>

      <nav aria-label="Profile sections">
        <ul className="tabs">
          {TABS.map((name) => (
            <li key={name}>
              <Link href={`?tab=${name}`} aria-current={name === tab ? "page" : undefined}>
                {LABELS[name]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && (
        <section aria-label="Overview">
          <p>{payload.description}</p>
          <h2>When to use</h2>
          <ul>
            {payload.whenToUse.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {payload.whenNotToUse.length > 0 && (
            <>
              <h2>When not to use</h2>
              <ul>
                {payload.whenNotToUse.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <h2>Output</h2>
          <p>
            Format: {payload.output.format}. Template: {payload.output.template ? "set" : "none yet"}.
          </p>
          <h2>Export</h2>
          <p>
            <a href={`/profiles/${profileId}/export?format=json`}>Download JSON</a>
            {" · "}
            <a href={`/profiles/${profileId}/export?format=markdown`}>Download Markdown</a>
          </p>
          <h2>Delete</h2>
          <ConfirmForm
            action={deleteProfile}
            fields={{ id: profileId }}
            label="Delete profile"
            warning="Delete this profile with all versions and drafts. Source documents stay."
          />
        </section>
      )}

      {tab === "structure" && (
        <section aria-label="Structure">
          {payload.structure.length === 0 ? (
            <p>No sections defined.</p>
          ) : (
            <ol>
              {payload.structure.map((section) => (
                <li key={section.title}>
                  <strong>{section.title}</strong>
                  {section.required ? "" : " (optional)"}: {section.guidance}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {tab === "rules" && (
        <section aria-label="Rules">
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
                  <td>{rule.strength}</td>
                  <td>{rule.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "evidence" && (
        <section aria-label="Evidence">
          {payload.evidence.length === 0 ? (
            <p>No evidence. All rules come from you or the product defaults.</p>
          ) : (
            payload.evidence.map((item, index) => (
              <figure key={index}>
                <blockquote>{item.excerpt}</blockquote>
                <figcaption>Supports {item.ruleId}</figcaption>
              </figure>
            ))
          )}
        </section>
      )}

      {tab === "template" && (
        <section aria-label="Template">
          {payload.output.template ? (
            <>
              <p>
                Typst template your agent compiles the {payload.output.format.toUpperCase()} with.{" "}
                <a href={`/profiles/${profileId}/template`}>Download template.typ</a>
              </p>
              <pre>{payload.output.template}</pre>
            </>
          ) : (
            <p>
              No template yet. Ask your agent to build one from your examples, for example &quot;use TAME to
              build a template for {payload.name} from my examples&quot;.
            </p>
          )}
        </section>
      )}

      {history && "versions" in history && (
        <section aria-label="History">
          <table>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Reason</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {history.versions.map((version) => (
                <tr key={version.versionId}>
                  <td>
                    v{version.versionNumber}
                    {version.active && " (active)"}
                  </td>
                  <td>{version.reason ?? "First version"}</td>
                  <td>{version.createdAt.toLocaleString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Ask your agent to roll back if an older version was better.</p>
        </section>
      )}
    </>
  );
}
