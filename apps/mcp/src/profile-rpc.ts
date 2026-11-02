import type { Principal } from "./auth.js";
import type { McpConfig } from "./config.js";

export class ProfileFailure extends Error {
  constructor(readonly code: "permission_denied" | "invalid_draft" | "invalid_evidence" | "draft_conflict" | "not_found" | "profiles_unavailable"
    | "draft_changed" | "draft_not_pending" | "idempotency_conflict" | "invalid_request") { super(code); }
}
type Operation = "create_mcp_profile_draft" | "get_mcp_profile_draft" | "save_mcp_profile_version" | "find_mcp_profiles" | "get_mcp_profile";
export function createProfileRpc(config: McpConfig, request: typeof fetch = fetch) {
  const headers: Record<string, string> = { apikey: config.secretKey, "Content-Type": "application/json", Accept: "application/json" };
  if (!config.secretKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${config.secretKey}`;
  return async (principal: Principal, operation: Operation, input: Record<string, unknown>): Promise<unknown> => {
    try {
      const response = await request(`${config.supabaseUrl}/rest/v1/rpc/${operation}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000), headers,
        body: JSON.stringify({ ...input, p_owner_id: principal.ownerId, p_client_id: principal.clientId, p_session_id: principal.sessionId }),
      });
      if (!response.body) throw new Error("Missing response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 256 * 1024) throw new Error("Response limit exceeded.");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
      if (!response.ok) {
        const error = data as { code?: unknown; message?: unknown } | null;
        if (error?.code === "42501") throw new ProfileFailure("permission_denied");
        if (error?.code === "23505" && error.message === "draft_conflict") throw new ProfileFailure("draft_conflict");
        if (error?.code === "23505" && error.message === "idempotency_conflict") throw new ProfileFailure("idempotency_conflict");
        if (error?.code === "22023") {
          for (const code of ["invalid_evidence", "invalid_draft", "draft_changed", "draft_not_pending", "invalid_request"] as const) {
            if (error.message === code) throw new ProfileFailure(code);
          }
        }
        if (error?.code === "P0002" && error.message === "not_found") throw new ProfileFailure("not_found");
        throw new Error("Operation failed.");
      }
      return data;
    } catch (error) {
      if (error instanceof ProfileFailure) throw error;
      throw new ProfileFailure("profiles_unavailable");
    }
  };
}
