import { mediaTypeForName, uploadRequestSchema } from "@tame/contracts";
import type { DocumentStatus, ExtractionResult, UploadRequest } from "@tame/contracts";
import type { CoreContext } from "./context.js";
import { getCollection } from "./collections.js";
import { notFound, TameError } from "./errors.js";

export type DocumentSummary = {
  id: string;
  collectionId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorCode: string | null;
  createdAt: Date;
};

const summaryColumns = [
  "id",
  "collection_id",
  "name",
  "media_type",
  "size_bytes",
  "status",
  "error_code",
  "created_at",
] as const;

type SummaryRow = {
  id: string;
  collection_id: string;
  name: string;
  media_type: string;
  size_bytes: number;
  status: string;
  error_code: string | null;
  created_at: Date;
};

function toSummary(row: SummaryRow): DocumentSummary {
  return {
    id: row.id,
    collectionId: row.collection_id,
    name: row.name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    status: row.status as DocumentStatus,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

async function findDocument({ db }: CoreContext, ownerId: string, documentId: string) {
  const row = await db
    .selectFrom("documents")
    .where("id", "=", documentId)
    .where("owner_id", "=", ownerId)
    .select([...summaryColumns, "storage_path"])
    .executeTakeFirst();
  if (!row) throw notFound("Document");
  return row;
}

export async function listDocuments(context: CoreContext, ownerId: string, collectionId: string) {
  await getCollection(context, ownerId, collectionId);
  const rows = await context.db
    .selectFrom("documents")
    .where("collection_id", "=", collectionId)
    .where("owner_id", "=", ownerId)
    .select(summaryColumns)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map(toSummary);
}

export async function registerUpload(context: CoreContext, ownerId: string, request: UploadRequest) {
  const parsed = uploadRequestSchema.safeParse(request);
  if (!parsed.success)
    throw new TameError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid upload.");
  const { collectionId, name, sizeBytes } = parsed.data;
  await getCollection(context, ownerId, collectionId);
  const id = crypto.randomUUID();
  const row = await context.db
    .insertInto("documents")
    .values({
      id,
      owner_id: ownerId,
      collection_id: collectionId,
      name,
      media_type: mediaTypeForName(name)!,
      size_bytes: sizeBytes,
      storage_path: `${ownerId}/${id}/original`,
    })
    .returning(summaryColumns)
    .executeTakeFirstOrThrow();
  return toSummary(row);
}

export async function createUploadUrl(context: CoreContext, ownerId: string, documentId: string) {
  const document = await findDocument(context, ownerId, documentId);
  if (document.status !== "uploading") {
    throw new TameError("conflict", "This document is not waiting for an upload.");
  }
  return {
    url: await context.files.createUploadUrl(document.storage_path),
    contentType: document.media_type,
  };
}

// Runs after the browser finished uploading, and again when the user retries a failed extraction
export async function extractUploadedDocument(context: CoreContext, ownerId: string, documentId: string) {
  const document = await findDocument(context, ownerId, documentId);
  if (document.status !== "uploading" && document.status !== "failed") return toSummary(document);

  const bytes = await context.files.download(document.storage_path);
  if (!bytes) throw new TameError("not_found", "The uploaded file was not found. Upload it again.");
  if (bytes.byteLength !== document.size_bytes) {
    throw new TameError(
      "invalid_input",
      "The uploaded file does not match the registered size. Upload it again.",
    );
  }

  let result: ExtractionResult | null = null;
  let runError = "parser_crashed";
  try {
    result = await context.extract(bytes, document.media_type);
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") runError = error.code;
  }
  await saveExtraction(context, ownerId, documentId, result, runError);
  return toSummary(await findDocument(context, ownerId, documentId));
}

async function saveExtraction(
  { db }: CoreContext,
  ownerId: string,
  documentId: string,
  result: ExtractionResult | null,
  runError: string,
) {
  await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom("documents")
      .where("id", "=", documentId)
      .where("owner_id", "=", ownerId)
      .select("id")
      .forUpdate()
      .executeTakeFirstOrThrow();
    await trx.deleteFrom("document_sections").where("document_id", "=", documentId).execute();

    if (result?.status === "ready") {
      await trx
        .insertInto("document_sections")
        .values(
          result.sections.map((section) => ({
            document_id: documentId,
            owner_id: ownerId,
            ordinal: section.ordinal,
            page: section.page,
            heading: section.heading,
            content: section.content,
          })),
        )
        .execute();
    }

    await trx
      .updateTable("documents")
      .where("id", "=", documentId)
      .set({
        status: result?.status ?? "failed",
        error_code: result && result.status !== "ready" ? result.errorCode : result ? null : runError,
        warnings: JSON.stringify(result?.warnings ?? []),
        content_hash: result?.contentHash ?? null,
        parser_version: result?.parserVersion ?? null,
        extracted_at: new Date(),
      })
      .execute();
  });
}

export async function deleteDocument(context: CoreContext, ownerId: string, documentId: string) {
  const document = await findDocument(context, ownerId, documentId);
  await context.files.remove([document.storage_path]);
  await context.db
    .deleteFrom("documents")
    .where("id", "=", documentId)
    .where("owner_id", "=", ownerId)
    .execute();
}
