import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import {
  COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGE, collectionListSchema,
  collectionNameSchema, collectionSchema, readCollectionPage,
} from "./schema";

export async function listCollections(ownerId: string, page = 1) {
  const currentPage = readCollectionPage(String(page));
  const offset = (currentPage - 1) * COLLECTION_PAGE_SIZE;
  const supabase = await createSupabaseServerClient({ readOnly: true });
  const { data, error } = await supabase.from("collections")
    .select("id,name,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + COLLECTION_PAGE_SIZE);

  if (error) throw new Error("Unable to load collections.");
  const parsed = collectionListSchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid collections response.");
  return {
    items: parsed.data.slice(0, COLLECTION_PAGE_SIZE),
    hasNextPage: parsed.data.length > COLLECTION_PAGE_SIZE && currentPage < MAX_COLLECTION_PAGE,
  };
}

export async function createCollection(ownerId: string, name: string) {
  const parsedName = collectionNameSchema.parse(name);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("collections")
    .insert({ name: parsedName, owner_id: ownerId })
    .select("id,name,created_at")
    .single();

  if (error) throw new Error("Unable to create collection.");
  const parsed = collectionSchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid collection response.");
  return parsed.data;
}
