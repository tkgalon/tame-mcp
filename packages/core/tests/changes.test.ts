import { describe, expect, it } from "vitest";
import type { ProfilePayload } from "@tame/contracts";
import { diffProfiles, hasChanges } from "../src/changes";

const base: ProfilePayload = {
  schemaVersion: 2,
  name: "CTF Write-up",
  description: "Weekly lab reports.",
  whenToUse: ["CTF lab"],
  whenNotToUse: [],
  output: { format: "pdf", template: null },
  structure: [],
  rules: [
    {
      id: "title-bold",
      category: "format",
      instruction: "Bold title.",
      strength: "required",
      origin: "user_stated",
    },
    {
      id: "plain-tone",
      category: "style",
      instruction: "Plain tone.",
      strength: "preferred",
      origin: "user_stated",
    },
  ],
  evidence: [],
};

describe("diffProfiles", () => {
  it("reports no changes for identical profiles", () => {
    expect(hasChanges(diffProfiles(base, structuredClone(base)))).toBe(false);
  });

  it("separates added, removed and changed rules", () => {
    const next: ProfilePayload = {
      ...base,
      rules: [
        { ...base.rules[0]!, instruction: "Bold title, same size as body." },
        {
          id: "blank-line",
          category: "format",
          instruction: "Blank line.",
          strength: "optional",
          origin: "user_stated",
        },
      ],
    };
    const changes = diffProfiles(base, next);
    expect(changes.rulesChanged).toEqual(["title-bold"]);
    expect(changes.rulesAdded).toEqual(["blank-line"]);
    expect(changes.rulesRemoved).toEqual(["plain-tone"]);
  });

  it("detects a template change as an output field change", () => {
    const next = { ...base, output: { format: "pdf" as const, template: "#set text(size: 12pt)" } };
    expect(diffProfiles(base, next).fields).toEqual(["output"]);
  });
});
