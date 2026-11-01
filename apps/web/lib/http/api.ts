import "server-only";

import { getAuthenticatedUser } from "../auth/session";
import { readAuthConfig } from "../auth/config";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function apiJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) {
    return apiJson({ error: { code: error.code, message: error.message } }, error.status);
  }
  return apiJson({ error: { code: "internal_error", message: "The request could not be completed." } }, 500);
}

export async function requireApiUser() {
  const user = await getAuthenticatedUser();
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export function requireSameOrigin(request: Request) {
  const config = readAuthConfig();
  if (!config) throw new ApiError(503, "auth_unavailable", "Authentication is not configured.");
  if (request.headers.get("origin") !== config.siteUrl) {
    throw new ApiError(403, "invalid_origin", "Send this request from the configured site origin.");
  }
}

export async function readJsonBody(request: Request, maxBytes = 8192): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "unsupported_content_type", "Send application/json metadata.");
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && Number(declaredSize) > maxBytes) {
    throw new ApiError(413, "body_too_large", "The metadata request is too large.");
  }
  if (!request.body) throw new ApiError(400, "invalid_json", "Send a JSON request body.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "body_too_large", "The metadata request is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "Send a valid UTF-8 JSON request body.");
  } finally {
    reader.releaseLock();
  }
}
