import { describe, expect, it } from "vitest";
import type { ProfilePayload } from "@tame/contracts";
import { exportFilename, profileMarkdown } from "../lib/export";

const payload: ProfilePayload = {
  schemaVersion: 2,
  name: "CTF Write-up",
  description: "Weekly lab reports (PDF).",
  whenToUse: ["CTF lab"],
  whenNotToUse: [],
  output: { format: "pdf", template: null },
  structure: [{ title: "Ringkasan Praktik", required: true, guidance: "Tools, then findings." }],
  rules: [
    {
      id: "title-bold",
      category: "format",
      instruction: "Bold the title. Keep body size.",
      strength: "required",
      origin: "user_stated",
    },
  ],
  evidence: [],
};

describe("profileMarkdown", () => {
  it("renders readable Markdown without escaping punctuation", () => {
    const markdown = profileMarkdown({ profileId: "p", versionNumber: 3, payload });
    expect(markdown).toContain("# CTF Write-up (v3)");
    expect(markdown).toContain("Weekly lab reports (PDF).");
    expect(markdown).toContain("1. Ringkasan Praktik: Tools, then findings.");
    expect(markdown).not.toContain("\\.");
  });

  it("builds a safe filename from the profile name", () => {
    expect(exportFilename({ profileId: "p", versionNumber: 2, payload }, "md")).toBe("ctf-write-up-v2.md");
  });
});
