import type { CoreContext } from "./context.js";
import { listCollections } from "./collections.js";
import { listDocuments } from "./documents.js";
import { notFound, TameError } from "./errors.js";

export const SECTIONS_PER_READ = 3;

export async function listExamples(context: CoreContext, ownerId: string, collectionId?: string) {
  if (!collectionId) {
    const collections = await listCollections(context, ownerId);
    return {
      collections: collections.map(({ id, name, documentCount }) => ({ id, name, documentCount })),
    };
  }
  const documents = await listDocuments(context, ownerId, collectionId);
  return {
    documents: documents.map(({ id, name, mediaType, status }) => ({ id, name, mediaType, status })),
  };
}

export async function readExample(context: CoreContext, ownerId: string, documentId: string, after = -1) {
  const document = await context.db
    .selectFrom("documents")
    .where("id", "=", documentId)
    .where("owner_id", "=", ownerId)
    .select(["id", "name", "status"])
    .executeTakeFirst();
  if (!document) throw notFound("Document");
  if (document.status !== "ready") {
    throw new TameError("conflict", `This document is ${document.status}, so it has no readable text.`);
  }

  const rows = await context.db
    .selectFrom("document_sections")
    .where("document_id", "=", documentId)
    .where("ordinal", ">", after)
    .select(["ordinal", "page", "heading", "content"])
    .orderBy("ordinal")
    .limit(SECTIONS_PER_READ + 1)
    .execute();
  const sections = rows.slice(0, SECTIONS_PER_READ);
  return {
    document: { id: document.id, name: document.name },
    sections,
    nextAfter: rows.length > SECTIONS_PER_READ ? (sections.at(-1)?.ordinal ?? null) : null,
  };
}

// Evidence must be text the user really wrote, so each excerpt is matched against stored sections
export async function findMissingExcerpts(
  { db }: CoreContext,
  ownerId: string,
  evidence: { documentId: string; excerpt: string }[],
): Promise<number[]> {
  const missing: number[] = [];
  for (const [index, item] of evidence.entries()) {
    const match = await db
      .selectFrom("document_sections as s")
      .innerJoin("documents as d", "d.id", "s.document_id")
      .where("d.id", "=", item.documentId)
      .where("d.owner_id", "=", ownerId)
      .where("d.status", "=", "ready")
      .where(({ fn, val }) => fn("strpos", ["s.content", val(item.excerpt)]), ">", 0)
      .select("s.ordinal")
      .executeTakeFirst();
    if (!match) missing.push(index);
  }
  return missing;
}
