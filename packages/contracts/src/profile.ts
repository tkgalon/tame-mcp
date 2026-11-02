import { z } from "zod";

const text = (limit: number) => z.string().trim().min(1).max(limit).refine(value => !value.includes("\0"));
const id = z.uuid().toLowerCase();
export const profileRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
  category: z.enum(["structure", "style", "adaptation", "factual"]),
  instruction: text(1000),
  strength: z.enum(["required", "preferred", "optional"]),
  origin: z.enum(["inferred", "user_stated", "product_default", "unconfirmed"]),
});
export const profileEvidenceSchema = z.strictObject({
  ruleId: profileRuleSchema.shape.id, documentId: id, sectionId: id,
  extractionVersion: z.number().int().min(1).max(2_147_483_647),
  excerpt: z.string().min(1).max(1000).refine(value => value.trim().length > 0 && !value.includes("\0")),
});
export const taskProfileSchema = z.strictObject({
  schemaVersion: z.literal(1), name: text(120), description: text(2000), purpose: text(2000),
  usageConditions: z.strictObject({
    whenToUse: z.array(text(500)).min(1).max(10), whenNotToUse: z.array(text(500)).max(10),
  }),
  rules: z.array(profileRuleSchema).min(1).max(20),
  evidence: z.array(profileEvidenceSchema).max(40),
}).superRefine((profile, context) => {
  const ids = new Set<string>();
  for (const [index, rule] of profile.rules.entries()) {
    if (ids.has(rule.id)) context.addIssue({ code: "custom", path: ["rules", index, "id"], message: "Rule IDs must be unique." });
    ids.add(rule.id);
    if (rule.origin === "inferred" && !profile.evidence.some(item => item.ruleId === rule.id)) {
      context.addIssue({ code: "custom", path: ["rules", index], message: "Inferred rules require source evidence. Use unconfirmed for tentative rules." });
    }
    if (rule.origin === "unconfirmed" && rule.strength === "required") {
      context.addIssue({ code: "custom", path: ["rules", index], message: "Unconfirmed rules cannot be required." });
    }
  }
  const evidenceKeys = new Set<string>();
  for (const [index, item] of profile.evidence.entries()) {
    if (!ids.has(item.ruleId)) context.addIssue({ code: "custom", path: ["evidence", index, "ruleId"], message: "Evidence must reference an existing rule." });
    const key = JSON.stringify(item);
    if (evidenceKeys.has(key)) context.addIssue({ code: "custom", path: ["evidence", index], message: "Duplicate evidence is not allowed." });
    evidenceKeys.add(key);
  }
});
export const createProfileDraftSchema = z.strictObject({
  draftId: id, payload: taskProfileSchema,
  preview: z.string().max(6000).refine(value => !value.includes("\0")),
}).refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 48 * 1024, {
  message: "A draft must fit within 48 KiB including preview and evidence.",
});
export const getProfileDraftSchema = z.strictObject({ draftId: id });
export const profileChangesSchema = z.strictObject({
  fields: z.array(z.string()).max(10), rulesAdded: z.array(z.string()).max(20),
  rulesRemoved: z.array(z.string()).max(20), rulesChanged: z.array(z.string()).max(20), evidenceChanged: z.boolean(),
});
export const proposeProfileUpdateSchema = z.strictObject({
  draftId: id, profileId: id, baseVersionId: id, payload: taskProfileSchema,
  preview: z.string().max(6000).refine(value => !value.includes("\0")), reason: text(1000),
}).refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 48 * 1024, {
  message: "An update proposal must fit within 48 KiB.",
});
export const profileDraftSchema = z.strictObject({
  id: z.uuid(), status: z.enum(["pending_review", "published", "rejected"]), schemaVersion: z.literal(1),
  payload: taskProfileSchema, preview: z.string().max(6000),
  draftHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime({ offset: true }),
  profileId: z.uuid().nullable().optional(), baseVersionId: z.uuid().nullable().optional(),
  changeReason: z.string().max(1000).nullable().optional(), changes: profileChangesSchema.nullable().optional(),
  restoredFromVersionId: z.uuid().nullable().optional(),
});
export type ProposeProfileUpdate = z.infer<typeof proposeProfileUpdateSchema>;
export type TaskProfile = z.infer<typeof taskProfileSchema>;
export type CreateProfileDraft = z.infer<typeof createProfileDraftSchema>;
export type ProfileDraft = z.infer<typeof profileDraftSchema>;
