import Link from "next/link";
import { ConfirmForm } from "../../../../components/confirm";
import { DocumentTable } from "../../../../components/document-table";
import type { DocumentRow } from "../../../../components/document-table";
import { UploadForm } from "../../../../components/upload-form";
import { deleteCollection } from "../actions";

type Props = { collection: { id: string; name: string }; documents: DocumentRow[] };

export function CollectionView({ collection, documents }: Props) {
  return (
    <>
      <div className="ph rise">
        <div>
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/collections">Collections</Link>
            <i>/</i>
            {collection.name}
          </nav>
          <h1>{collection.name}</h1>
        </div>
      </div>

      <section className="card rise d1" aria-labelledby="up">
        <div className="card-h">
          <h2 id="up">Upload examples</h2>
          <span className="small">PDF, DOCX, TXT or Markdown, up to 10 MiB each.</span>
        </div>
        <UploadForm collectionId={collection.id} />
      </section>

      <section className="card rise d2" aria-labelledby="docs">
        <div className="card-h">
          <h2 id="docs">Documents</h2>
          <span className="small">
            {documents.length} {documents.length === 1 ? "document" : "documents"}
          </span>
        </div>
        {documents.length === 0 ? (
          <div className="empty">
            <p className="small">No documents yet. Upload a few finished examples above.</p>
          </div>
        ) : (
          <DocumentTable collectionId={collection.id} documents={documents} />
        )}
      </section>

      <section className="card rise d3" aria-labelledby="danger">
        <div className="card-h">
          <h2 id="danger">Delete collection</h2>
        </div>
        <div className="card-b" style={{ display: "grid", gap: 12 }}>
          <p className="small">Delete this collection and all its files.</p>
          <ConfirmForm
            action={deleteCollection}
            fields={{ id: collection.id }}
            label="Delete collection"
            message="Delete this collection and all its files."
          />
        </div>
      </section>
    </>
  );
}
