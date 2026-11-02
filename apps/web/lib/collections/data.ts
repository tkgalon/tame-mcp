import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { z } from "zod";
import { ApiError } from "../http/api";
import {
  COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGE, collectionListSchema,
  collectionNameSchema, collectionSchema, readCollectionPage,
} from "./schema";

export async function getCollection(ownerId: string, collectionId: string) {
  const id = z.uuid().parse(collectionId).toLowerCase();
  const supabase = await createSupabaseServerClient({ readOnly: true });
  const { data, error } = await supabase.from("collections").select("id,owner_id,name,created_at")
    .eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new ApiError(502, "storage_unavailable", "Unable to load the collection.");
  if (!data) throw new ApiError(404, "not_found", "Collection not found.");
  const parsed = collectionSchema.extend({ owner_id: z.uuid() }).safeParse(data);
  if (!parsed.success || parsed.data.id !== id || parsed.data.owner_id !== ownerId) {
    throw new ApiError(502, "invalid_provider_response", "The collection service returned an invalid response.");
  }
  return collectionSchema.parse(parsed.data);
}

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
