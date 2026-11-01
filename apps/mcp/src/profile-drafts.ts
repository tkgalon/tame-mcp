import { createProfileDraftSchema, getProfileDraftSchema, profileDraftSchema } from "@tame/contracts";
import type { CreateProfileDraft } from "@tame/contracts";
import type { Principal } from "./auth.js";
import type { McpConfig } from "./config.js";

export class ProfileDraftFailure extends Error {
  constructor(readonly code: "permission_denied" | "invalid_draft" | "invalid_evidence" | "draft_conflict" | "not_found" | "profiles_unavailable") { super(code); }
}
export function createProfileDraftRepository(config: McpConfig, request: typeof fetch = fetch) {
  const headers: Record<string, string> = { apikey: config.secretKey, "Content-Type": "application/json", Accept: "application/json" };
  if (!config.secretKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${config.secretKey}`;

  async function rpc(principal: Principal, operation: "create_mcp_profile_draft" | "get_mcp_profile_draft", input: Record<string, unknown>) {
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
          if (size > 128 * 1024) throw new Error("Response limit exceeded.");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
      if (!response.ok) {
        const error = data as { code?: unknown; message?: unknown } | null;
        if (error?.code === "42501") throw new ProfileDraftFailure("permission_denied");
        if (error?.code === "23505" && error.message === "draft_conflict") throw new ProfileDraftFailure("draft_conflict");
        if (error?.code === "22023" && error.message === "invalid_evidence") throw new ProfileDraftFailure("invalid_evidence");
        if (error?.code === "22023" && error.message === "invalid_draft") throw new ProfileDraftFailure("invalid_draft");
        throw new Error("Operation failed.");
      }
      if (data === null && operation === "get_mcp_profile_draft") throw new ProfileDraftFailure("not_found");
      const result = profileDraftSchema.parse(data);
      if (result.id !== input["p_draft_id"]) throw new Error("Draft mismatch.");
      return result;
    } catch (error) {
      if (error instanceof ProfileDraftFailure) throw error;
      throw new ProfileDraftFailure("profiles_unavailable");
    }
  }
  return {
    async create(principal: Principal, value: CreateProfileDraft) {
      if (!principal.permissions.includes("write_profiles")) throw new ProfileDraftFailure("permission_denied");
      const parsed = createProfileDraftSchema.safeParse(value);
      if (!parsed.success) throw new ProfileDraftFailure("invalid_draft");
      if (parsed.data.payload.evidence.length > 0 && !principal.permissions.includes("read_examples")) throw new ProfileDraftFailure("permission_denied");
      return rpc(principal, "create_mcp_profile_draft", { p_draft_id: parsed.data.draftId, p_payload: parsed.data.payload, p_preview: parsed.data.preview });
    },
    async get(principal: Principal, value: { draftId: string }) {
      if (!principal.permissions.includes("read_profiles")) throw new ProfileDraftFailure("permission_denied");
      const parsed = getProfileDraftSchema.safeParse(value);
      if (!parsed.success) throw new ProfileDraftFailure("invalid_draft");
      return rpc(principal, "get_mcp_profile_draft", { p_draft_id: parsed.data.draftId });
    },
  };
}
export type ProfileDraftRepository = ReturnType<typeof createProfileDraftRepository>;
