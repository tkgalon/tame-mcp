import {
  activeProfileSchema, findProfilesSchema, findProfilesResultSchema, getProfileSchema,
  saveProfileVersionSchema, savedProfileVersionSchema,
} from "@tame/contracts";
import type { SaveProfileVersion, FindProfiles } from "@tame/contracts";
import type { Principal } from "./auth.js";
import type { McpConfig } from "./config.js";
import { createProfileDraftRepository } from "./profile-drafts.js";
import { createProfileRpc, ProfileFailure } from "./profile-rpc.js";

export function createProfileRegistry(config: McpConfig, request: typeof fetch = fetch) {
  const rpc = createProfileRpc(config, request);
  const drafts = createProfileDraftRepository(config, request);
  function requireRead(principal: Principal) {
    if (!principal.permissions.includes("read_profiles")) throw new ProfileFailure("permission_denied");
  }
  return {
    async save(principal: Principal, input: SaveProfileVersion) {
      requireRead(principal);
      if (!principal.permissions.includes("write_profiles")) throw new ProfileFailure("permission_denied");
      const parsed = saveProfileVersionSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const value = parsed.data;
      const draft = await drafts.get(principal, { draftId: value.draftId });
      if (draft.draftHash !== value.draftHash) throw new ProfileFailure("draft_changed");
      if (draft.payload.evidence.length > 0 && !principal.permissions.includes("read_examples")) throw new ProfileFailure("permission_denied");
      const data = await rpc(principal, "save_mcp_profile_version", {
        p_draft_id: value.draftId, p_draft_hash: value.draftHash, p_idempotency_key: value.idempotencyKey, p_approval: value.approval,
      });
      const result = savedProfileVersionSchema.safeParse(data);
      if (!result.success || result.data.draftId !== value.draftId || result.data.draftHash !== value.draftHash) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
    async find(principal: Principal, input: FindProfiles) {
      requireRead(principal);
      const parsed = findProfilesSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const data = await rpc(principal, "find_mcp_profiles", { p_query: parsed.data.query, p_page: parsed.data.page });
      const result = findProfilesResultSchema.safeParse(data);
      if (!result.success || (result.data.nextPage !== null && result.data.nextPage !== parsed.data.page + 1)) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
    async get(principal: Principal, input: { profileId: string }) {
      requireRead(principal);
      const parsed = getProfileSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const data = await rpc(principal, "get_mcp_profile", { p_profile_id: parsed.data.profileId });
      if (data === null) throw new ProfileFailure("not_found");
      const result = activeProfileSchema.safeParse(data);
      if (!result.success || result.data.id !== parsed.data.profileId) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
  };
}
export type ProfileRegistry = ReturnType<typeof createProfileRegistry>;
