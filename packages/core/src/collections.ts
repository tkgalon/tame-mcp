import { collectionNameSchema } from "@tame/contracts";
import type { CoreContext } from "./context.js";
import { notFound, TameError } from "./errors.js";

export type CollectionSummary = { id: string; name: string; createdAt: Date; documentCount: number };

export async function listCollections({ db }: CoreContext, ownerId: string): Promise<CollectionSummary[]> {
  const rows = await db
    .selectFrom("collections as c")
    .leftJoin("documents as d", "d.collection_id", "c.id")
    .where("c.owner_id", "=", ownerId)
    .groupBy(["c.id", "c.name", "c.created_at"])
    .select(({ fn }) => ["c.id", "c.name", "c.created_at", fn.count<string>("d.id").as("document_count")])
    .orderBy("c.created_at", "desc")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    documentCount: Number(row.document_count),
  }));
}

export async function getCollection({ db }: CoreContext, ownerId: string, collectionId: string) {
  const row = await db
    .selectFrom("collections")
    .where("id", "=", collectionId)
    .where("owner_id", "=", ownerId)
    .select(["id", "name", "created_at"])
    .executeTakeFirst();
  if (!row) throw notFound("Collection");
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function createCollection({ db }: CoreContext, ownerId: string, name: string) {
  const parsed = collectionNameSchema.safeParse(name);
  if (!parsed.success) throw new TameError("invalid_input", "Use a name of 1 to 120 characters.");
  return db
    .insertInto("collections")
    .values({ owner_id: ownerId, name: parsed.data })
    .returning(["id", "name"])
    .executeTakeFirstOrThrow();
}

// Files go first: a failed database delete can be retried, but orphaned files would leak private data
export async function deleteCollection(context: CoreContext, ownerId: string, collectionId: string) {
  const { db, files } = context;
  await getCollection(context, ownerId, collectionId);
  const documents = await db
    .selectFrom("documents")
    .where("collection_id", "=", collectionId)
    .where("owner_id", "=", ownerId)
    .select("storage_path")
    .execute();
  await files.remove(documents.map((document) => document.storage_path));
  await db.deleteFrom("collections").where("id", "=", collectionId).where("owner_id", "=", ownerId).execute();
}
