import { describe, expect, it } from "vitest";
import { draftProfileInput, profilePayloadSchema } from "../src/index";
import type { ProfilePayload } from "../src/index";

const documentId = "11111111-1111-4111-8111-111111111111";

export function validPayload(overrides: Partial<ProfilePayload> = {}): ProfilePayload {
  return {
    schemaVersion: 2,
    name: "CTF Write-up",
    description: "Weekly CTF lab write-ups submitted as PDF.",
    whenToUse: ["Writing a CTF lab report"],
    whenNotToUse: [],
    output: { format: "pdf", template: null },
    structure: [
      { title: "Ringkasan Praktik", required: true, guidance: "What was examined, then the key finding." },
    ],
    rules: [
      {
        id: "title-bold",
        category: "format",
        instruction: "Bold the title without enlarging it.",
        strength: "required",
        origin: "user_stated",
      },
      {
        id: "answer-own-line",
        category: "structure",
        instruction: "Put the answer value in bold on its own line.",
        strength: "preferred",
        origin: "inferred",
      },
    ],
    evidence: [{ ruleId: "answer-own-line", documentId, excerpt: "336a7cf476ebc7548c93507339196abb" }],
    ...overrides,
  };
}

describe("profilePayloadSchema", () => {
  it("accepts a complete profile", () => {
    expect(profilePayloadSchema.safeParse(validPayload()).success).toBe(true);
  });

  it("requires evidence for inferred rules", () => {
    const result = profilePayloadSchema.safeParse(validPayload({ evidence: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects duplicate rule IDs", () => {
    const payload = validPayload();
    const result = profilePayloadSchema.safeParse({
      ...payload,
      rules: [payload.rules[0], payload.rules[0]],
    });
    expect(result.success).toBe(false);
  });

  it("rejects required rules that are still unconfirmed", () => {
    const payload = validPayload();
    const rules = [{ ...payload.rules[0]!, origin: "unconfirmed" as const }, payload.rules[1]!];
    expect(profilePayloadSchema.safeParse({ ...payload, rules }).success).toBe(false);
  });

  it("rejects evidence pointing at a missing rule", () => {
    const evidence = [{ ruleId: "missing", documentId, excerpt: "text" }];
    expect(profilePayloadSchema.safeParse(validPayload({ evidence })).success).toBe(false);
  });

  it("rejects profiles above the size limit", () => {
    const output = { format: "pdf" as const, template: "x".repeat(20_000) };
    const description = "y".repeat(2_000);
    const whenToUse = Array.from({ length: 10 }, () => "z".repeat(500));
    const structure = Array.from({ length: 30 }, (_, index) => ({
      title: `Section ${index}`,
      required: false,
      guidance: "g".repeat(1000),
    }));
    const rules = Array.from({ length: 30 }, (_, index) => ({
      id: `rule-${index}`,
      category: "style" as const,
      instruction: "r".repeat(1000),
      strength: "optional" as const,
      origin: "user_stated" as const,
    }));
    const payload = validPayload({ output, description, whenToUse, structure, rules, evidence: [] });
    const result = profilePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain("A profile must fit within 64 KiB.");
  });
});

describe("draftProfileInput", () => {
  it("requires a reason when revising a profile", () => {
    const result = draftProfileInput.safeParse({
      payload: validPayload(),
      preview: "",
      profileId: documentId,
      baseVersionId: documentId,
    });
    expect(result.success).toBe(false);
  });

  it("requires profileId and baseVersionId together", () => {
    const result = draftProfileInput.safeParse({
      payload: validPayload(),
      preview: "",
      profileId: documentId,
    });
    expect(result.success).toBe(false);
  });
});
