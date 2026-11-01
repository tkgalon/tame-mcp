import { z } from "zod";
import type { Principal } from "./auth.js";
import type { McpConfig } from "./config.js";
import {
  collectionSchema, documentSchema, sectionSchema, pageInputSchema, documentsInputSchema, readInputSchema,
  EXAMPLE_PAGE_SIZE, SECTION_PAGE_SIZE,
} from "./examples-schema.js";

export class ExampleFailure extends Error {
  constructor(readonly code: "permission_denied" | "not_found" | "examples_unavailable" | "extraction_changed" | "extraction_not_ready") { super(code); }
}
const collectionColumns = "id,owner_id,name,created_at";
const documentColumns = "id,owner_id,collection_id,name,media_type,size_bytes,status,created_at,extraction_version,warnings";
const sectionColumns = "id,owner_id,document_id,extraction_version,ordinal,heading,page,content,source_start,source_end";
const ownedCollection = collectionSchema.extend({ owner_id: z.uuid() });
const ownedDocument = documentSchema.extend({ owner_id: z.uuid() });
const ownedSection = sectionSchema.safeExtend({ owner_id: z.uuid() });

export function createExampleRepository(config: McpConfig, request: typeof fetch = fetch) {
  const headers: Record<string, string> = { apikey: config.secretKey, Accept: "application/json" };
  if (!config.secretKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${config.secretKey}`;

  async function rows<T>(principal: Principal, table: string, columns: string, schema: z.ZodType<T>, filters: Record<string, string>, limit: number) {
    if (!principal.permissions.includes("read_examples")) throw new ExampleFailure("permission_denied");
    const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
    url.search = new URLSearchParams({ ...filters, select: columns, owner_id: `eq.${principal.ownerId}`, limit: String(limit) }).toString();
    try {
      const response = await request(url, { headers, redirect: "error", signal: AbortSignal.timeout(5_000) });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Read failed."); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 512 * 1024) throw new Error("Response limit exceeded.");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data = z.array(schema).max(limit).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))));
      for (const row of data) {
        if ((row as { owner_id?: string }).owner_id !== principal.ownerId) throw new Error("Owner mismatch.");
      }
      return data;
    } catch { throw new ExampleFailure("examples_unavailable"); }
  }
  async function document(principal: Principal, id: string) {
    const result = await rows(principal, "documents", documentColumns, ownedDocument, { id: `eq.${id}` }, 1);
    if (!result[0]) throw new ExampleFailure("not_found");
    if (result[0].id !== id) throw new ExampleFailure("examples_unavailable");
    return documentSchema.parse(result[0]);
  }
  function page<T>(items: T[], current: number) {
    return { items: items.slice(0, EXAMPLE_PAGE_SIZE), nextPage: items.length > EXAMPLE_PAGE_SIZE && current < 10_000 ? current + 1 : null };
  }
  return {
    async listCollections(principal: Principal, input: z.input<typeof pageInputSchema>) {
      const { page: current } = pageInputSchema.parse(input);
      const items = await rows(principal, "collections", collectionColumns, ownedCollection,
        { order: "created_at.desc,id.desc", offset: String((current - 1) * EXAMPLE_PAGE_SIZE) }, EXAMPLE_PAGE_SIZE + 1);
      return page(items.map(item => collectionSchema.parse(item)), current);
    },
    async listDocuments(principal: Principal, input: z.input<typeof documentsInputSchema>) {
      const { collectionId, page: current } = documentsInputSchema.parse(input);
      const parent = await rows(principal, "collections", collectionColumns, ownedCollection, { id: `eq.${collectionId}` }, 1);
      if (!parent[0]) throw new ExampleFailure("not_found");
      if (parent[0].id !== collectionId) throw new ExampleFailure("examples_unavailable");
      const items = await rows(principal, "documents", documentColumns, ownedDocument,
        { collection_id: `eq.${collectionId}`, order: "created_at.desc,id.desc", offset: String((current - 1) * EXAMPLE_PAGE_SIZE) }, EXAMPLE_PAGE_SIZE + 1);
      if (items.some(item => item.collection_id !== collectionId)) throw new ExampleFailure("examples_unavailable");
      return page(items.map(item => documentSchema.parse(item)), current);
    },
    async readDocument(principal: Principal, input: z.input<typeof readInputSchema>) {
      const { documentId, version, after } = readInputSchema.parse(input);
      const detail = await document(principal, documentId);
      if (version !== undefined && version !== detail.extraction_version) throw new ExampleFailure("extraction_changed");
      if (detail.status !== "ready") throw new ExampleFailure("extraction_not_ready");
      const sections = await rows(principal, "document_sections", sectionColumns, ownedSection, {
        document_id: `eq.${documentId}`, extraction_version: `eq.${detail.extraction_version}`,
        ordinal: `gt.${after ?? -1}`, order: "ordinal.asc",
      }, SECTION_PAGE_SIZE + 1);
      let previous = after ?? -1;
      for (const section of sections) {
        if (section.document_id !== documentId || section.extraction_version !== detail.extraction_version
          || section.ordinal !== previous + 1) throw new ExampleFailure("examples_unavailable");
        previous = section.ordinal;
      }
      const current = await document(principal, documentId);
      if (current.extraction_version !== detail.extraction_version || current.status !== "ready") throw new ExampleFailure("extraction_changed");
      const items = sections.slice(0, SECTION_PAGE_SIZE).map(item => sectionSchema.parse(item));
      return { document: detail, sections: items, extractionVersion: detail.extraction_version,
        nextAfter: sections.length > SECTION_PAGE_SIZE ? items.at(-1)!.ordinal : null };
    },
  };
}
export type ExampleRepository = ReturnType<typeof createExampleRepository>;
