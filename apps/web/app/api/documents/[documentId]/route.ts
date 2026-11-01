import { apiFailure, apiJson, ApiError, requireApiUser } from "../../../../lib/http/api";
import { getDocument } from "../../../../lib/documents/read";
import { resourceIdSchema } from "../../../../lib/documents/schema";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser();
    const { documentId } = await context.params;
    if (!resourceIdSchema.safeParse(documentId).success) throw new ApiError(400, "invalid_id", "Provide a valid document ID.");
    return apiJson({ document: await getDocument(user.id, documentId) });
  } catch (error) { return apiFailure(error); }
}
