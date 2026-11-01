import { AuthFailure, connectionSchema } from "./auth.js";
import type { GrantResolver } from "./auth.js";
import type { McpConfig } from "./config.js";

export function createGrantResolver(config: McpConfig, request: typeof fetch = fetch): GrantResolver {
  const headers: Record<string, string> = { apikey: config.secretKey, "Content-Type": "application/json" };
  if (!config.secretKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${config.secretKey}`;
  return async identity => {
    try {
      const response = await request(`${config.supabaseUrl}/rest/v1/rpc/resolve_mcp_connection`, {
        method: "POST", redirect: "error", headers, signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({ p_owner_id: identity.ownerId, p_client_id: identity.clientId, p_session_id: identity.sessionId }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Connection lookup failed."); }
      if (!response.body) throw new Error("Missing response.");
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16_384) throw new Error("Response limit exceeded.");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
      if (result === null) return null;
      return connectionSchema.parse(result);
    } catch { throw new AuthFailure(503, "auth_unavailable"); }
  };
}
