import { z } from "zod";
import { idSchema, MAX_PREVIEW_CHARACTERS, profilePayloadSchema } from "./profile.js";

const confirmation = z
  .literal(true)
  .describe("Set only after the user explicitly confirmed this action in the conversation");

export const useProfileInput = z.strictObject({
  task: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe("The user's request or a profile name, used to pick the matching profile"),
  profileId: idSchema.optional().describe("Use this profile directly when the ID is already known"),
});

export const listExamplesInput = z.strictObject({
  collectionId: idSchema.optional().describe("Omit to list collections, set to list its documents"),
});

export const readExampleInput = z.strictObject({
  documentId: idSchema,
  after: z
    .number()
    .int()
    .min(-1)
    .default(-1)
    .describe("Continue from the nextAfter value of the previous call"),
});

export const draftProfileInput = z
  .strictObject({
    payload: profilePayloadSchema,
    preview: z
      .string()
      .max(MAX_PREVIEW_CHARACTERS)
      .describe("A short illustrative sample written with the profile, labelled as an illustration"),
    profileId: idSchema.optional().describe("Set together with baseVersionId to revise an existing profile"),
    baseVersionId: idSchema.optional().describe("The versionId returned by use_profile or profile_history"),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe("Why the profile changes, required for revisions"),
  })
  .refine((input) => (input.profileId === undefined) === (input.baseVersionId === undefined), {
    message: "profileId and baseVersionId must be set together.",
  })
  .refine((input) => input.profileId === undefined || input.reason !== undefined, {
    message: "A revision needs a reason.",
  });

export const publishProfileInput = z.strictObject({
  draftId: idSchema,
  userConfirmed: confirmation,
});

export const profileHistoryInput = z.strictObject({
  profileId: idSchema,
  versionId: idSchema.optional().describe("Set to read one historical snapshot"),
});

export const rollbackProfileInput = z.strictObject({
  profileId: idSchema,
  baseVersionId: idSchema.describe("The currently active versionId"),
  targetVersionId: idSchema.describe("The older version to restore"),
  reason: z.string().trim().min(1).max(1000),
  userConfirmed: confirmation,
});

export type UseProfileInput = z.infer<typeof useProfileInput>;
export type ListExamplesInput = z.infer<typeof listExamplesInput>;
export type ReadExampleInput = z.infer<typeof readExampleInput>;
export type DraftProfileInput = z.infer<typeof draftProfileInput>;
export type PublishProfileInput = z.infer<typeof publishProfileInput>;
export type ProfileHistoryInput = z.infer<typeof profileHistoryInput>;
export type RollbackProfileInput = z.infer<typeof rollbackProfileInput>;
