import { apiFailure, apiJson, ApiError, requireApiUser } from "../../../../../lib/http/api";
import { listDocuments } from "../../../../../lib/documents/data";
import { documentPageSchema, resourceIdSchema } from "../../../../../lib/documents/schema";

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  try {
    const user = await requireApiUser();
    const { collectionId } = await context.params;
    if (!resourceIdSchema.safeParse(collectionId).success) throw new ApiError(400, "invalid_id", "Provide a valid collection ID.");
    const page = documentPageSchema.safeParse(new URL(request.url).searchParams.get("page") ?? 1);
    if (!page.success) throw new ApiError(400, "invalid_page", "Provide a page between 1 and 10000.");
    return apiJson(await listDocuments(user.id, collectionId, page.data));
  } catch (error) {
    return apiFailure(error);
  }
}
