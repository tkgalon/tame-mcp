import { z } from "zod";
import { taskProfileSchema } from "./profile.js";

const id = z.uuid().toLowerCase();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const saveProfileVersionSchema = z.strictObject({
  draftId: id, draftHash: hash, idempotencyKey: id,
  approval: z.literal("user_requested"),
});
export const findProfilesSchema = z.strictObject({
  query: z.string().trim().max(120).refine(value => !value.includes("\0")).default(""),
  page: z.number().int().min(1).max(10_000).default(1),
});
export const getProfileSchema = z.strictObject({ profileId: id });
export const getProfileVersionSchema = z.strictObject({ profileId: id, versionId: id });
export const listProfileVersionsSchema = z.strictObject({ profileId: id, before: z.number().int().positive().max(2_147_483_647).optional() });
export const rollbackProfileSchema = z.strictObject({
  profileId: id, targetVersionId: id, baseVersionId: id, reason: z.string().trim().min(1).max(1000).refine(value => !value.includes("\0")),
  idempotencyKey: id, approval: z.literal("user_requested"),
});
export const profileVersionEntrySchema = z.strictObject({
  versionId: z.uuid(), versionNumber: z.number().int().positive(), approvedAt: z.iso.datetime({ offset: true }),
  approvalChannel: z.enum(["chat", "web"]), changeReason: z.string().max(1000).nullable(), restoredFromVersionId: z.uuid().nullable(),
});
export const profileVersionsResultSchema = z.strictObject({
  items: z.array(profileVersionEntrySchema).max(20), nextBefore: z.number().int().positive().nullable(),
});
export const profileSummarySchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), description: z.string().max(2000),
  versionId: z.uuid(), versionNumber: z.number().int().positive(), approvedAt: z.iso.datetime({ offset: true }),
});
export const activeProfileSchema = z.strictObject({
  ...profileSummarySchema.shape,
  schemaVersion: z.literal(1), payload: taskProfileSchema, approvalChannel: z.enum(["chat", "web"]),
  changeReason: z.string().max(1000).nullable().optional(), restoredFromVersionId: z.uuid().nullable().optional(),
  evidenceStatus: z.array(z.strictObject({
    ruleId: z.string(), documentId: z.uuid(), sectionId: z.uuid(),
    status: z.enum(["available", "changed", "unavailable"]),
  })).max(40),
}).superRefine((profile, context) => {
  if (profile.name !== profile.payload.name || profile.description !== profile.payload.description) {
    context.addIssue({ code: "custom", message: "Profile identity must match its version snapshot." });
  }
  if (profile.evidenceStatus.length !== profile.payload.evidence.length || profile.evidenceStatus.some((source, index) => {
    const evidence = profile.payload.evidence[index];
    return !evidence || source.ruleId !== evidence.ruleId || source.documentId !== evidence.documentId || source.sectionId !== evidence.sectionId;
  })) context.addIssue({ code: "custom", message: "Evidence status must match the version evidence in order." });
});
export const findProfilesResultSchema = z.strictObject({
  items: z.array(profileSummarySchema).max(20), nextPage: z.number().int().min(1).max(10_000).nullable(),
});
export const savedProfileVersionSchema = z.strictObject({
  draftId: z.uuid(), draftHash: hash, profile: activeProfileSchema,
});
export type SaveProfileVersion = z.infer<typeof saveProfileVersionSchema>;
export type FindProfiles = z.input<typeof findProfilesSchema>;
export type RollbackProfile = z.infer<typeof rollbackProfileSchema>;
