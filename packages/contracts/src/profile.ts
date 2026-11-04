import { z } from "zod";

export const PROFILE_SCHEMA_VERSION = 2;
export const MAX_PROFILE_BYTES = 64 * 1024;
export const MAX_TEMPLATE_CHARACTERS = 20_000;
export const MAX_PREVIEW_CHARACTERS = 6_000;
export const TEMPLATE_COMPONENTS = [
  "doc",
  "section",
  "question",
  "answer",
  "cmd",
  "shot",
  "flag",
  "table",
] as const;
const TEMPLATE_ENTRY = /#let\s+doc\s*\(/;

const noNul = (value: string) => !value.includes("\0");
const text = (limit: number) => z.string().trim().min(1).max(limit).refine(noNul);
export const idSchema = z.uuid().toLowerCase();

export const profileRuleSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,59}$/)
    .describe("Short stable identifier, for example title-bold"),
  category: z.enum(["structure", "style", "format", "factual"]),
  instruction: text(1000),
  strength: z.enum(["required", "preferred", "optional"]),
  origin: z
    .enum(["inferred", "user_stated", "product_default", "unconfirmed"])
    .describe("inferred rules need evidence, user_stated rules come from the user in chat"),
});

export const profileEvidenceSchema = z.strictObject({
  ruleId: profileRuleSchema.shape.id,
  documentId: idSchema,
  excerpt: z
    .string()
    .min(1)
    .max(1000)
    .refine((value) => value.trim().length > 0 && noNul(value))
    .describe("Verbatim text copied from a section of the document"),
});

export const profileSectionSchema = z.strictObject({
  title: text(200),
  required: z.boolean(),
  guidance: text(1000),
});

export const profileOutputSchema = z.strictObject({
  format: z.enum(["pdf", "markdown", "text"]),
  template: z
    .string()
    .max(MAX_TEMPLATE_CHARACTERS)
    .refine(noNul)
    .nullable()
    .refine((value) => value === null || TEMPLATE_ENTRY.test(value), {
      message: "A template must define doc, the function the whole document is wrapped in.",
    })
    .describe(
      "Typst source that fixes fonts, colors and layout, with a doc function and one function per repeated element, or null",
    ),
});

export const profilePayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
    name: text(120),
    description: text(2000),
    whenToUse: z.array(text(500)).min(1).max(10),
    whenNotToUse: z.array(text(500)).max(10),
    output: profileOutputSchema,
    structure: z.array(profileSectionSchema).max(30),
    rules: z.array(profileRuleSchema).min(1).max(30),
    evidence: z.array(profileEvidenceSchema).max(40),
  })
  .superRefine((profile, context) => {
    const ruleIds = new Set<string>();
    for (const [index, rule] of profile.rules.entries()) {
      if (ruleIds.has(rule.id)) {
        context.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: "Rule IDs must be unique.",
        });
      }
      ruleIds.add(rule.id);
      if (rule.origin === "inferred" && !profile.evidence.some((item) => item.ruleId === rule.id)) {
        context.addIssue({
          code: "custom",
          path: ["rules", index],
          message: "Inferred rules need evidence. Use unconfirmed for tentative rules.",
        });
      }
      if (rule.origin === "unconfirmed" && rule.strength === "required") {
        context.addIssue({
          code: "custom",
          path: ["rules", index],
          message: "Unconfirmed rules cannot be required.",
        });
      }
    }
    for (const [index, item] of profile.evidence.entries()) {
      if (!ruleIds.has(item.ruleId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "ruleId"],
          message: "Evidence must reference an existing rule.",
        });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(profile)).byteLength > MAX_PROFILE_BYTES) {
      context.addIssue({ code: "custom", path: [], message: "A profile must fit within 64 KiB." });
    }
  });

export type ProfileRule = z.infer<typeof profileRuleSchema>;
export type ProfileEvidence = z.infer<typeof profileEvidenceSchema>;
export type ProfilePayload = z.infer<typeof profilePayloadSchema>;

export type ProfileChanges = {
  fields: string[];
  rulesAdded: string[];
  rulesRemoved: string[];
  rulesChanged: string[];
  evidenceChanged: boolean;
};
