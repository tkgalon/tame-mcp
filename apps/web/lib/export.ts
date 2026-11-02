import type { ProfilePayload } from "@tame/contracts";

type Exported = { profileId: string; versionNumber: number; payload: ProfilePayload };

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

export function profileMarkdown({ versionNumber, payload }: Exported): string {
  const sections = [
    `# ${payload.name} (v${versionNumber})`,
    payload.description,
    `## When to use\n\n${list(payload.whenToUse)}`,
    payload.whenNotToUse.length ? `## When not to use\n\n${list(payload.whenNotToUse)}` : "",
    `## Output\n\nFormat: ${payload.output.format}`,
    payload.output.template ? `### Template\n\n\`\`\`typst\n${payload.output.template}\n\`\`\`` : "",
    payload.structure.length
      ? `## Structure\n\n${payload.structure
          .map(
            (section, index) =>
              `${index + 1}. ${section.title}${section.required ? "" : " (optional)"}: ${section.guidance}`,
          )
          .join("\n")}`
      : "",
    `## Rules\n\n${list(payload.rules.map((rule) => `${rule.instruction} (${rule.category}, ${rule.strength}, ${rule.origin})`))}`,
    payload.evidence.length
      ? `## Evidence\n\n${payload.evidence.map((item) => `> ${item.excerpt.replaceAll("\n", "\n> ")}\n\nSupports ${item.ruleId}`).join("\n\n")}`
      : "",
  ];
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

export function exportFilename({ payload, versionNumber }: Exported, extension: "json" | "md"): string {
  const slug =
    payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  return `${slug}-v${versionNumber}.${extension}`;
}
