import { MAX_STYLE_ENTRIES, MAX_STYLE_SAMPLE_CHARACTERS } from "@tame/contracts";
import type { DocumentStyle } from "@tame/contracts";

type TextStyle = DocumentStyle["textStyles"][number];
export type TextRun = Omit<TextStyle, "share" | "sample"> & { text: string };

export function shortSample(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return [...clean].slice(0, MAX_STYLE_SAMPLE_CHARACTERS).join("");
}

export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

// Counts characters per style so the summary lists what the document mostly looks like
export class StyleTally {
  private readonly styles = new Map<
    string,
    { style: Omit<TextStyle, "share" | "alignment">; characters: number; alignments: Map<string, number> }
  >();
  private readonly fills = new Map<string, { count: number; sample: string | null }>();
  private total = 0;

  addText(run: TextRun): void {
    const characters = [...run.text.replace(/\s/g, "")].length;
    if (characters === 0) return;
    this.total += characters;
    const { text, alignment, ...style } = run;
    const normalized = { ...style, sizePt: round(style.sizePt), color: normalizeColor(style.color) };
    const key = JSON.stringify(normalized);
    let entry = this.styles.get(key);
    if (entry) {
      entry.characters += characters;
      entry.style.sample ??= shortSample(text);
    } else {
      entry = { style: { ...normalized, sample: shortSample(text) }, characters, alignments: new Map() };
      this.styles.set(key, entry);
    }
    // Alignment is a vote, so short last lines of a justified paragraph do not split the style
    if (alignment) entry.alignments.set(alignment, (entry.alignments.get(alignment) ?? 0) + characters);
  }

  addFill(color: string | null, sample: string | null): void {
    const normalized = normalizeColor(color);
    if (!normalized || normalized === "#ffffff") return;
    const entry = this.fills.get(normalized);
    if (entry) {
      entry.count++;
      entry.sample ??= sample;
    } else {
      this.fills.set(normalized, { count: 1, sample });
    }
  }

  textStyles(): TextStyle[] {
    return [...this.styles.values()]
      .sort((left, right) => right.characters - left.characters)
      .slice(0, MAX_STYLE_ENTRIES)
      .map(({ style, characters, alignments }) => {
        const top = [...alignments].sort((left, right) => right[1] - left[1])[0]?.[0];
        return {
          ...style,
          alignment: (top ?? null) as TextStyle["alignment"],
          share: Math.round((characters / this.total) * 1000) / 1000,
        };
      });
  }

  fillList(): DocumentStyle["fills"] {
    return [...this.fills.entries()]
      .sort((left, right) => right[1].count - left[1].count)
      .slice(0, MAX_STYLE_ENTRIES)
      .map(([color, { count, sample }]) => ({ color, count, sample }));
  }
}
