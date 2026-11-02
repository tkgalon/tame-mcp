import {
  activeProfileSchema, findProfilesSchema, findProfilesResultSchema, getProfileSchema,
  saveProfileVersionSchema, savedProfileVersionSchema,
  proposeProfileUpdateSchema, profileDraftSchema, getProfileVersionSchema, listProfileVersionsSchema, profileVersionsResultSchema, rollbackProfileSchema,
} from "@tame/contracts";
import type { SaveProfileVersion, FindProfiles, ProposeProfileUpdate, RollbackProfile } from "@tame/contracts";
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
    async propose(principal: Principal, input: ProposeProfileUpdate) {
      requireRead(principal);
      if (!principal.permissions.includes("write_profiles")) throw new ProfileFailure("permission_denied");
      const parsed = proposeProfileUpdateSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const value = parsed.data;
      if (value.payload.evidence.length && !principal.permissions.includes("read_examples")) throw new ProfileFailure("permission_denied");
      const data = await rpc(principal, "propose_mcp_profile_update", {
        p_draft_id: value.draftId, p_profile_id: value.profileId, p_base_version_id: value.baseVersionId,
        p_payload: value.payload, p_preview: value.preview, p_reason: value.reason,
      });
      const result = profileDraftSchema.safeParse(data);
      if (!result.success || result.data.id !== value.draftId || result.data.profileId !== value.profileId
        || result.data.baseVersionId !== value.baseVersionId || !result.data.changes) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
    async history(principal: Principal, input: { profileId: string; before?: number | undefined }) {
      requireRead(principal);
      const parsed = listProfileVersionsSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const data = await rpc(principal, "list_mcp_profile_versions", { p_profile_id: parsed.data.profileId, p_before: parsed.data.before ?? null });
      const result = profileVersionsResultSchema.safeParse(data);
      if (!result.success) throw new ProfileFailure("profiles_unavailable");
      let previous = parsed.data.before ?? Infinity;
      for (const item of result.data.items) {
        if (item.versionNumber >= previous) throw new ProfileFailure("profiles_unavailable");
        previous = item.versionNumber;
      }
      if (result.data.nextBefore !== null && result.data.nextBefore !== result.data.items.at(-1)?.versionNumber) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
    async version(principal: Principal, input: { profileId: string; versionId: string }) {
      requireRead(principal);
      const parsed = getProfileVersionSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const data = await rpc(principal, "get_mcp_profile_version", { p_profile_id: parsed.data.profileId, p_version_id: parsed.data.versionId });
      if (data === null) throw new ProfileFailure("not_found");
      const result = activeProfileSchema.safeParse(data);
      if (!result.success || result.data.id !== parsed.data.profileId || result.data.versionId !== parsed.data.versionId) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
    async rollback(principal: Principal, input: RollbackProfile) {
      requireRead(principal);
      if (!principal.permissions.includes("write_profiles")) throw new ProfileFailure("permission_denied");
      const parsed = rollbackProfileSchema.safeParse(input);
      if (!parsed.success) throw new ProfileFailure("invalid_request");
      const value = parsed.data;
      const target = await this.version(principal, { profileId: value.profileId, versionId: value.targetVersionId });
      if (target.payload.evidence.length && !principal.permissions.includes("read_examples")) throw new ProfileFailure("permission_denied");
      const data = await rpc(principal, "rollback_mcp_profile", {
        p_profile_id: value.profileId, p_target_version_id: value.targetVersionId, p_base_version_id: value.baseVersionId,
        p_reason: value.reason, p_idempotency_key: value.idempotencyKey, p_approval: value.approval,
      });
      const result = savedProfileVersionSchema.safeParse(data);
      if (!result.success || result.data.profile.id !== value.profileId || result.data.profile.restoredFromVersionId !== value.targetVersionId) throw new ProfileFailure("profiles_unavailable");
      return result.data;
    },
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
