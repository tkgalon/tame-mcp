import { apiFailure, apiJson, ApiError, requireApiUser, requireSameOrigin } from "../../../../../lib/http/api";
import { createUploadUrl } from "../../../../../lib/documents/data";
import { resourceIdSchema } from "../../../../../lib/documents/schema";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    requireSameOrigin(request);
    const user = await requireApiUser();
    const { documentId } = await context.params;
    if (!resourceIdSchema.safeParse(documentId).success) throw new ApiError(400, "invalid_id", "Provide a valid document ID.");
    return apiJson({ upload: await createUploadUrl(user.id, documentId) });
  } catch (error) {
    return apiFailure(error);
  }
}
