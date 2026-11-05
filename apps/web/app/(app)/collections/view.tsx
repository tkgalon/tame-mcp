import Link from "next/link";
import { CreateCollectionForm } from "../../../components/create-collection-form";
import { Sig } from "../../../components/sig";
import type { Tone } from "../../../components/sig";

export type CollectionRow = { id: string; name: string; documents: number; attention: number };

function readiness({ documents, attention }: CollectionRow): { tone: Tone; label: string } {
  if (documents === 0) return { tone: "off", label: "No documents" };
  if (attention === 0) return { tone: "ok", label: "All ready" };
  return { tone: "warn", label: `${attention} ${attention === 1 ? "needs" : "need"} attention` };
}

export function CollectionsView({ collections }: { collections: CollectionRow[] }) {
  return (
    <>
      <div className="ph rise">
        <div>
          <h1>Collections</h1>
          <p className="lead">
            A collection holds examples of one kind of document, for example your reports.
          </p>
        </div>
      </div>

      <section className="card rise d1" aria-labelledby="new">
        <div className="card-h">
          <h2 id="new">New collection</h2>
        </div>
        <CreateCollectionForm />
      </section>

      <section className="card rise d2" aria-labelledby="your">
        <div className="card-h">
          <h2 id="your">Your collections</h2>
          <span className="small">
            {collections.length} {collections.length === 1 ? "collection" : "collections"}
          </span>
        </div>
        {collections.length === 0 ? (
          <div className="empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7h6l2 2h10v10H3z" />
            </svg>
            <h3>No collections yet</h3>
            <p className="small">Create one above, then upload a few finished documents of the same kind.</p>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Documents</th>
                  <th scope="col" className="hide-sm">
                    Ready
                  </th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => {
                  const status = readiness(collection);
                  return (
                    <tr key={collection.id}>
                      <td>
                        <Link href={`/collections/${collection.id}`} style={{ fontWeight: 600 }}>
                          {collection.name}
                        </Link>
                      </td>
                      <td>{collection.documents}</td>
                      <td className="hide-sm">
                        <Sig tone={status.tone}>{status.label}</Sig>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link className="btn sm" href={`/collections/${collection.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
