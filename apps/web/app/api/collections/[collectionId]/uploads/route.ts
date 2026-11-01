import { apiFailure, apiJson, ApiError, readJsonBody, requireApiUser, requireSameOrigin } from "../../../../../lib/http/api";
import { registerUpload } from "../../../../../lib/documents/data";
import { uploadMetadataSchema } from "../../../../../lib/documents/upload-schema";

export async function POST(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  try {
    requireSameOrigin(request);
    const user = await requireApiUser();
    const { collectionId } = await context.params;
    const body = await readJsonBody(request);
    const parsed = uploadMetadataSchema.safeParse({
      ...(typeof body === "object" && body !== null ? body : {}), collectionId,
    });
    if (!parsed.success) throw new ApiError(400, "invalid_upload", "Provide a supported filename and a file size between 1 byte and 10 MiB.");
    return apiJson({ document: await registerUpload(user.id, parsed.data) }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
