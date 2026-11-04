import type { ProfilePayload } from "@tame/contracts";
import { expect, test } from "vitest";
import { profileChecklist } from "../src/profiles";

const profile: ProfilePayload = {
  schemaVersion: 2,
  name: "CTF Write-up",
  description: "Weekly write-ups.",
  whenToUse: ["CTF"],
  whenNotToUse: [],
  output: { format: "pdf", template: null },
  structure: [
    { title: "Ringkasan", required: true, guidance: "What was examined." },
    { title: "Referensi", required: false, guidance: "Sources." },
  ],
  rules: [
    {
      id: "no-semicolons",
      category: "style",
      instruction: "No semicolons.",
      strength: "required",
      origin: "user_stated",
    },
    {
      id: "casual",
      category: "style",
      instruction: "Casual tone.",
      strength: "preferred",
      origin: "user_stated",
    },
  ],
  evidence: [],
};

test("the checklist lists required sections and rules, and the look for pdf output", () => {
  const markdown = { ...profile, output: { format: "markdown" as const, template: null } };
  expect(profileChecklist(markdown)).toEqual(['Has the section "Ringkasan".', "No semicolons."]);
  expect(profileChecklist(profile).at(-1)).toBe(
    "Looks like the source documents: same page layout, fonts, colors, boxes, header and footer.",
  );
});
