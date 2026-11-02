import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "../../../lib/auth/session";
import { getCollection } from "../../../lib/collections/data";
import { readCollectionPage } from "../../../lib/collections/schema";
import { listDocuments } from "../../../lib/documents/data";
import { resourceIdSchema } from "../../../lib/documents/schema";
import { ApiError } from "../../../lib/http/api";
import { RefreshDocumentsButton, UploadDocumentForm } from "../../../components/upload-document-form";

export const dynamic = "force-dynamic";
const statusDescriptions = {
  uploading: "Upload has not been confirmed.",
  uploaded: "Waiting for extraction.",
  processing: "Extracting document text.",
  ready: "Ready for your connected agent to read.",
  needs_ocr: "No usable text was extracted. This document needs OCR, which is not supported yet.",
  unsupported: "This document format could not be extracted.",
  failed: "Extraction failed. Try uploading another copy of the document.",
};

export default async function CollectionPage({ params, searchParams }: {
  params: Promise<{ collectionId: string }>; searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireUser();
  const parsed = resourceIdSchema.safeParse((await params).collectionId);
  if (!parsed.success) notFound();
  const collectionId = parsed.data.toLowerCase();
  const page = readCollectionPage((await searchParams).page);
  let collection;
  try { collection = await getCollection(user.id, collectionId); }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <main><p><Link href="/collections">Collections</Link></p><h1>Collection unavailable</h1>
      <p role="alert">Unable to load the collection. Try again in a moment.</p><RefreshDocumentsButton /></main>;
  }
  const documents = await listDocuments(user.id, collectionId, page).catch(() => null);
  const path = `/collections/${collectionId}`;
  return <main>
    <p><Link href="/collections">Collections</Link></p>
    <h1>{collection.name}</h1>
    <UploadDocumentForm collectionId={collectionId} />
    <h2>Documents</h2>
    <p>After uploading, refresh status until the document is ready.</p>
    <RefreshDocumentsButton />
    {!documents ? <p role="alert">Unable to load documents. Try refreshing.</p>
      : documents.items.length === 0 ? <p>{page === 1 ? "No documents yet. Upload one to get started." : "No documents on this page."}</p>
      : <ul>{documents.items.map(document => <li key={document.id}>
        <p><strong>{document.name}</strong> — {(document.size_bytes / 1024).toFixed(1)} KiB</p>
        <p>Status: <strong>{document.status}</strong>. {statusDescriptions[document.status]}</p>
      </li>)}</ul>}
    {documents && <nav aria-label="Document pages">
      {page > 1 && <p><Link href={`${path}?page=${page - 1}`}>Previous page</Link></p>}
      {documents.hasNextPage && <p><Link href={`${path}?page=${page + 1}`}>Next page</Link></p>}
      {page > 1 && <p><Link href={path}>First page</Link></p>}
    </nav>}
  </main>;
}
