import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "../supabase/server";
import { ApiError } from "../http/api";
import { uploadMetadataSchema } from "./upload-schema";
import type { UploadMetadata } from "./upload-schema";
import {
  DOCUMENT_PAGE_SIZE, MAX_DOCUMENT_PAGE, documentPageSchema,
  documentSchema, storedDocumentSchema,
} from "./schema";

type ProviderError = { code?: string; message?: string };

function rpcFailure(error: ProviderError, resource: "collection" | "document") {
  if (error.code === "P0002") return new ApiError(404, "not_found", `The ${resource} or its uploaded object was not found.`);
  if (error.code === "42501") return new ApiError(403, "forbidden", "This session cannot perform the operation.");
  if (error.code === "22023") return new ApiError(409, "invalid_upload", "Upload metadata does not match the expected document.");
  return new ApiError(502, "storage_unavailable", "The document operation is unavailable. Try again.");
}

function ownedDocument(value: unknown, ownerId: string) {
  const parsed = storedDocumentSchema.safeParse(value);
  if (!parsed.success || parsed.data.owner_id !== ownerId ||
    parsed.data.storage_path !== `${ownerId}/${parsed.data.id}/original`) {
    throw new ApiError(502, "invalid_provider_response", "The document operation returned an invalid response.");
  }
  return parsed.data;
}

export async function registerUpload(ownerId: string, input: UploadMetadata) {
  const metadata = uploadMetadataSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_document_upload", {
    p_collection_id: metadata.collectionId, p_name: metadata.name, p_size_bytes: metadata.sizeBytes,
  }).single();
  if (error) throw rpcFailure(error, "collection");
  const document = ownedDocument(data, ownerId);
  if (document.collection_id !== metadata.collectionId || document.status !== "uploading" ||
    document.media_type !== metadata.mediaType || document.size_bytes !== metadata.sizeBytes) {
    throw new ApiError(502, "invalid_provider_response", "The upload registration returned an invalid response.");
  }
  return documentSchema.parse(document);
}

export async function createUploadUrl(ownerId: string, documentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("documents")
    .select("id,collection_id,owner_id,name,media_type,size_bytes,status,created_at,storage_path")
    .eq("id", documentId).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new ApiError(502, "storage_unavailable", "Unable to load the document.");
  if (!data) throw new ApiError(404, "not_found", "Document not found.");
  const document = ownedDocument(data, ownerId);
  if (document.id !== documentId) throw new ApiError(502, "invalid_provider_response", "The document response does not match the request.");
  if (document.status !== "uploading") throw new ApiError(409, "upload_closed", "This document is no longer waiting for upload.");

  const { data: ticket, error: signingError } = await supabase.storage.from("documents")
    .createSignedUploadUrl(document.storage_path, { upsert: false });
  if (signingError) throw new ApiError(502, "signing_failed", "Unable to prepare upload. Retry with the same document ID.");
  const parsed = z.object({ path: z.string(), token: z.string().min(1), signedUrl: z.url() }).safeParse(ticket);
  if (!parsed.success || parsed.data.path !== document.storage_path) {
    throw new ApiError(502, "invalid_provider_response", "The upload service returned an invalid response.");
  }
  return { ...parsed.data, contentType: document.media_type, method: "PUT" as const };
}

export async function completeUpload(ownerId: string, documentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_document_upload", { p_document_id: documentId }).single();
  if (error) throw rpcFailure(error, "document");
  const document = ownedDocument(data, ownerId);
  if (document.id !== documentId || document.status === "uploading") {
    throw new ApiError(502, "invalid_provider_response", "Upload confirmation returned an invalid response.");
  }
  return documentSchema.parse(document);
}

export async function listDocuments(ownerId: string, collectionId: string, page = 1) {
  const currentPage = documentPageSchema.parse(page);
  const supabase = await createSupabaseServerClient({ readOnly: true });
  const { data: collection, error: collectionError } = await supabase.from("collections").select("id")
    .eq("id", collectionId).eq("owner_id", ownerId).maybeSingle();
  if (collectionError) throw new ApiError(502, "storage_unavailable", "Unable to load the collection.");
  if (!collection) throw new ApiError(404, "not_found", "Collection not found.");

  const offset = (currentPage - 1) * DOCUMENT_PAGE_SIZE;
  const { data, error } = await supabase.from("documents")
    .select("id,collection_id,name,media_type,size_bytes,status,created_at")
    .eq("collection_id", collectionId).eq("owner_id", ownerId)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + DOCUMENT_PAGE_SIZE);
  if (error) throw new ApiError(502, "storage_unavailable", "Unable to load documents.");
  const parsed = z.array(documentSchema).safeParse(data);
  if (!parsed.success || parsed.data.some(document => document.collection_id !== collectionId)) {
    throw new ApiError(502, "invalid_provider_response", "The document list returned an invalid response.");
  }
  return {
    items: parsed.data.slice(0, DOCUMENT_PAGE_SIZE), page: currentPage,
    hasNextPage: parsed.data.length > DOCUMENT_PAGE_SIZE && currentPage < MAX_DOCUMENT_PAGE,
  };
}
