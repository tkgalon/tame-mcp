import { apiFailure, apiJson, ApiError, requireApiUser } from "../../../../../lib/http/api";
import { listDocumentSections } from "../../../../../lib/documents/read";
import { resourceIdSchema, sectionQuerySchema } from "../../../../../lib/documents/schema";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser();
    const { documentId } = await context.params;
    if (!resourceIdSchema.safeParse(documentId).success) throw new ApiError(400, "invalid_id", "Provide a valid document ID.");
    const params = new URL(request.url).searchParams;
    const query = sectionQuerySchema.safeParse({ version: params.get("version") ?? undefined, after: params.get("after") ?? undefined });
    if (!query.success) throw new ApiError(400, "invalid_cursor", "Provide a valid extraction version and section cursor.");
    return apiJson(await listDocumentSections(user.id, documentId, query.data));
  } catch (error) { return apiFailure(error); }
}
