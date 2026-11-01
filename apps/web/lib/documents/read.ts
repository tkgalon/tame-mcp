import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "../supabase/server";
import { ApiError } from "../http/api";
import { documentDetailSchema, documentSectionSchema, SECTION_PAGE_SIZE, sectionQuerySchema, resourceIdSchema } from "./schema";
import type { SectionQuery } from "./schema";

const detailColumns = "id,collection_id,owner_id,name,media_type,size_bytes,status,created_at,extraction_version,content_hash,parser_version,warnings,extraction_error_code";
const sectionColumns = "id,owner_id,document_id,extraction_version,ordinal,heading,page,content,source_start,source_end";
const ownedDetailSchema = documentDetailSchema.extend({ owner_id: z.uuid() });
const ownedSectionSchema = documentSectionSchema.safeExtend({ owner_id: z.uuid() });

function invalidResponse() {
  return new ApiError(502, "invalid_provider_response", "The document service returned an invalid response.");
}

export async function getDocument(ownerId: string, documentId: string) {
  const id = resourceIdSchema.parse(documentId).toLowerCase();
  const supabase = await createSupabaseServerClient({ readOnly: true });
  const { data, error } = await supabase.from("documents").select(detailColumns)
    .eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new ApiError(502, "storage_unavailable", "Unable to load the document.");
  if (!data) throw new ApiError(404, "not_found", "Document not found.");
  const parsed = ownedDetailSchema.safeParse(data);
  if (!parsed.success || parsed.data.id !== id || parsed.data.owner_id !== ownerId) throw invalidResponse();
  return documentDetailSchema.parse(parsed.data);
}

export async function listDocumentSections(ownerId: string, documentId: string, input: SectionQuery = {}) {
  const query = sectionQuerySchema.parse(input);
  const document = await getDocument(ownerId, documentId);
  const version = query.version ?? document.extraction_version;
  if (version !== document.extraction_version) {
    throw new ApiError(409, "extraction_changed", "The extraction version has changed. Reload document details and start again.");
  }
  if (document.status !== "ready") {
    throw new ApiError(409, "extraction_not_ready", "Extracted sections are available only when the document is ready.");
  }
  const supabase = await createSupabaseServerClient({ readOnly: true });
  let request = supabase.from("document_sections").select(sectionColumns)
    .eq("owner_id", ownerId).eq("document_id", document.id).eq("extraction_version", version)
    .order("ordinal", { ascending: true }).limit(SECTION_PAGE_SIZE + 1);
  if (query.after !== undefined) request = request.gt("ordinal", query.after);
  const { data, error } = await request;
  if (error) throw new ApiError(502, "storage_unavailable", "Unable to load document sections.");
  const parsed = z.array(ownedSectionSchema).max(SECTION_PAGE_SIZE + 1).safeParse(data);
  if (!parsed.success) throw invalidResponse();
  let previous = query.after ?? -1;
  for (const section of parsed.data) {
    if (section.owner_id !== ownerId || section.document_id !== document.id
      || section.extraction_version !== version || section.ordinal <= previous) throw invalidResponse();
    previous = section.ordinal;
  }
  const items = parsed.data.slice(0, SECTION_PAGE_SIZE).map(section => documentSectionSchema.parse(section));
  return {
    items, extractionVersion: version,
    nextAfter: parsed.data.length > SECTION_PAGE_SIZE ? items.at(-1)!.ordinal : null,
  };
}
