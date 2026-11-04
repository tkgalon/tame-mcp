import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { DocumentStatus } from "@tame/contracts";
import { TameError } from "@tame/core";
import { ConfirmForm } from "../../../../components/confirm-form";
import { StyleSummary } from "../../../../components/style-summary";
import { UploadForm } from "../../../../components/upload-form";
import { getCore } from "../../../../lib/core";
import { requireUser } from "../../../../lib/session";
import { deleteCollection, deleteDocument, retryExtraction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<DocumentStatus, string> = {
  uploading: "The upload did not finish. Delete it and upload the file again.",
  ready: "Ready for your agent.",
  needs_ocr: "No text found. Scanned documents are not supported yet.",
  unsupported: "This format could not be read.",
  failed: "Reading failed.",
};

export default async function CollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const user = await requireUser();
  const { collectionId } = await params;
  if (!z.uuid().safeParse(collectionId).success) notFound();
  const core = getCore();
  const collection = await core.collections.get(user.id, collectionId).catch((error: unknown) => {
    if (error instanceof TameError) notFound();
    throw error;
  });
  const documents = await core.documents.list(user.id, collection.id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/collections">Collections</Link> / {collection.name}
      </nav>
      <h1>{collection.name}</h1>
      <UploadForm collectionId={collection.id} />

      <section aria-labelledby="documents">
        <h2 id="documents">Documents</h2>
        {documents.length === 0 ? (
          <p>No documents yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Size</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <Fragment key={document.id}>
                    <tr>
                      <td>{document.name}</td>
                      <td>{(document.sizeBytes / 1024).toFixed(1)} KiB</td>
                      <td>
                        {STATUS[document.status]}
                        {document.errorCode && ` Code: ${document.errorCode}.`}
                        {document.outdated && " Read by an older version without the style summary."}
                      </td>
                      <td>
                        {(document.status === "failed" || document.outdated) && (
                          <form action={retryExtraction}>
                            <input type="hidden" name="id" value={document.id} />
                            <button type="submit">{document.outdated ? "Read again" : "Retry"}</button>
                          </form>
                        )}
                        <ConfirmForm
                          action={deleteDocument}
                          fields={{ id: document.id, collectionId: collection.id }}
                          label="Delete"
                          warning="Delete this file. Profiles keep the quotes they already use."
                        />
                      </td>
                    </tr>
                    {document.style && (
                      <tr>
                        <td colSpan={4}>
                          <details>
                            <summary>Style of {document.name}</summary>
                            <StyleSummary style={document.style} />
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="danger">
        <h2 id="danger">Delete collection</h2>
        <ConfirmForm
          action={deleteCollection}
          fields={{ id: collection.id }}
          label="Delete collection"
          warning="Delete this collection and all its files."
        />
      </section>
    </>
  );
}
