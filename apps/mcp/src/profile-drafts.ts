import { createProfileDraftSchema, getProfileDraftSchema, profileDraftSchema } from "@tame/contracts";
import type { CreateProfileDraft } from "@tame/contracts";
import type { Principal } from "./auth.js";
import type { McpConfig } from "./config.js";

import { createProfileRpc, ProfileFailure as ProfileDraftFailure } from "./profile-rpc.js";
export { ProfileFailure as ProfileDraftFailure } from "./profile-rpc.js";

export function createProfileDraftRepository(config: McpConfig, request: typeof fetch = fetch) {
  const call = createProfileRpc(config, request);
  async function rpc(principal: Principal, operation: "create_mcp_profile_draft" | "get_mcp_profile_draft", input: Record<string, unknown>) {
    const data = await call(principal, operation, input);
    if (data === null && operation === "get_mcp_profile_draft") throw new ProfileDraftFailure("not_found");
    const parsed = profileDraftSchema.safeParse(data);
    if (!parsed.success || parsed.data.id !== input["p_draft_id"]) throw new ProfileDraftFailure("profiles_unavailable");
    return parsed.data;
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
