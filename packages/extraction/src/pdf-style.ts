import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { DocumentStyle } from "@tame/contracts";
import { shortSample, StyleTally } from "./style.js";

export const MAX_STYLE_PAGES = 30;
const MAX_STYLE_OPERATORS = 500_000;

type Matrix = [number, number, number, number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };
type Line = { x0: number; x1: number; y: number; size: number; text: string; items: TextItem[] };
type FontInfo = { name: string | null; bold: boolean; italic: boolean };

const FILL_OPS = new Set<number>([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke]);
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
]);
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function box(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const points = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]] as const);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Embedded fonts carry a subset prefix and a style suffix, the family is what a template needs
function fontInfo(page: PDFPageProxy, id: string, cache: Map<string, FontInfo>): FontInfo {
  const cached = cache.get(id);
  if (cached) return cached;
  let font: { name?: string; loadedName?: string; bold?: boolean; black?: boolean; italic?: boolean } = {};
  try {
    font = page.commonObjs.get(id) ?? {};
  } catch {
    // Fonts that failed to load still count as text, only without a name
  }
  const raw = (font.name ?? "").replace(/^[A-Z]{6}\+/, "");
  const info = {
    name:
      raw
        .replace(
          /[-,_ ]?(Bold|Black|Heavy|Semibold|SemiBold|Medium|Italic|Oblique|Regular|Roman|Book)+.*$/i,
          "",
        )
        .replace(/(PSMT|MT|PS)$/, "") || null,
    bold: Boolean(font.bold || font.black) || /bold|black|heavy/i.test(raw),
    italic: Boolean(font.italic) || /italic|oblique/i.test(raw),
  };
  cache.set(id, info);
  return info;
}

function groupLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const size = Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0);
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2);
    if (line) {
      line.x0 = Math.min(line.x0, x);
      line.x1 = Math.max(line.x1, x + item.width);
      line.size = Math.max(line.size, size);
      line.items.push(item);
    } else {
      lines.push({ x0: x, x1: x + item.width, y, size, text: "", items: [item] });
    }
  }
  for (const line of lines) {
    line.items.sort((left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0));
    line.text = line.items.map((item) => item.str).join(" ");
  }
  return lines;
}

const normalizeRepeat = (text: string) => text.replace(/\d+/g, "{n}").replace(/\s+/g, " ").trim();

export class PdfStyleCollector {
  private readonly tally = new StyleTally();
  private readonly fonts = new Map<string, FontInfo>();
  private readonly pageLines: { height: number; lines: Line[] }[] = [];
  private page: { widthPt: number; heightPt: number } | null = null;
  private images = 0;
  private rules = 0;
  private operators = 0;

  async addPage(page: PDFPageProxy, items: TextItem[]): Promise<void> {
    const [left = 0, bottom = 0, right = 0, top = 0] = page.view;
    const width = right - left;
    const height = top - bottom;
    this.page ??= { widthPt: Math.round(width * 10) / 10, heightPt: Math.round(height * 10) / 10 };
    const operators = await page.getOperatorList();
    this.operators += operators.fnArray.length;
    if (this.operators > MAX_STYLE_OPERATORS) throw new Error("Too many drawing operators to measure.");

    const fills: { color: string | null; box: Box }[] = [];
    const characterColors: (string | null)[] = [];
    const states: { matrix: Matrix; fill: string | null }[] = [];
    let matrix = IDENTITY;
    let fill: string | null = "#000000";
    for (const [index, fn] of operators.fnArray.entries()) {
      const args = operators.argsArray[index] as unknown[];
      if (fn === OPS.save) states.push({ matrix, fill });
      else if (fn === OPS.restore) ({ matrix, fill } = states.pop() ?? { matrix, fill });
      else if (fn === OPS.transform) matrix = multiply(matrix, args as Matrix);
      else if (fn === OPS.setFillRGBColor) fill = typeof args[0] === "string" ? args[0] : null;
      else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        for (const glyph of (args[0] ?? []) as unknown[]) {
          if (!glyph || typeof glyph !== "object" || !("unicode" in glyph)) continue;
          for (const character of String(glyph.unicode)) if (character.trim()) characterColors.push(fill);
        }
      } else if (fn === OPS.constructPath) {
        const [paint, , bounds] = args as [number, unknown, ArrayLike<number> | null];
        if (!bounds || bounds.length < 4) continue;
        const area = box(matrix, bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!);
        const thin = area.x1 - area.x0 <= 2.5 || area.y1 - area.y0 <= 2.5;
        if (STROKE_OPS.has(paint) || (FILL_OPS.has(paint) && thin)) this.rules++;
        else if (FILL_OPS.has(paint) && area.x1 - area.x0 >= 6 && area.y1 - area.y0 >= 6)
          fills.push({ color: fill, box: area });
      } else if (IMAGE_OPS.has(fn)) {
        const area = box(matrix, 0, 0, 1, 1);
        if (area.x1 - area.x0 >= 30 && area.y1 - area.y0 >= 30) this.images++;
      }
    }

    // Text content and drawing operators list the same characters in the same order
    let next = 0;
    const colors = new Map<TextItem, string | null>();
    for (const item of items) {
      let color: string | null | undefined;
      for (const character of item.str) {
        if (!character.trim()) continue;
        const value = characterColors[next++];
        if (color === undefined) color = value ?? null;
      }
      colors.set(item, color ?? null);
    }

    const lines = groupLines(items);
    const contentLeft = Math.min(...lines.map((line) => line.x0));
    const contentRight = Math.max(...lines.map((line) => line.x1));
    const contentWidth = contentRight - contentLeft;
    for (const line of lines) {
      const center = (line.x0 + line.x1) / 2;
      const alignment =
        line.x1 - line.x0 < contentWidth * 0.85 &&
        line.x0 > contentLeft + 15 &&
        Math.abs(center - (contentLeft + contentRight) / 2) < 8
          ? "center"
          : line.x0 > contentLeft + 15 && line.x1 >= contentRight - 3
            ? "right"
            : line.x1 - line.x0 >= contentWidth * 0.95
              ? "justify"
              : "left";
      for (const item of line.items) {
        const font = fontInfo(page, item.fontName, this.fonts);
        this.tally.addText({
          font: font.name,
          sizePt: Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0),
          bold: font.bold,
          italic: font.italic,
          color: colors.get(item) ?? null,
          alignment,
          text: item.str,
        });
      }
    }

    for (const { color, box: area } of fills) {
      const inside = lines.find(
        (line) => line.x0 >= area.x0 - 1 && line.x0 <= area.x1 && line.y >= area.y0 - 1 && line.y <= area.y1,
      );
      this.tally.addFill(color, inside ? shortSample(inside.text) : null);
    }
    this.pageLines.push({ height, lines });
  }

  result(): DocumentStyle {
    const pages = this.pageLines.length;
    // Lines that repeat on most pages near the edge, with numbers that change per page shown as {n}
    const repeated = (inBand: (line: Line, height: number) => boolean) => {
      const groups = new Map<string, string[]>();
      if (pages < 2) return { keys: new Set<string>(), labels: [] };
      for (const { height, lines } of this.pageLines) {
        const seen = new Set<string>();
        for (const line of lines.filter((candidate) => inBand(candidate, height))) {
          const key = normalizeRepeat(line.text);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          groups.set(key, [...(groups.get(key) ?? []), line.text.replace(/\s+/g, " ").trim()]);
        }
      }
      const kept = [...groups].filter(([, texts]) => texts.length >= Math.max(2, pages / 2)).slice(0, 5);
      return {
        keys: new Set(kept.map(([key]) => key)),
        labels: kept.map(([, texts]) => {
          const parts = texts.map((text) => text.split(/(\d+)/));
          const label = parts[0]!
            .map((part, index) => (index % 2 && parts.some((other) => other[index] !== part) ? "{n}" : part))
            .join("");
          return shortSample(label)!;
        }),
      };
    };
    // Headers and footers sit in the outer 7% of the page, above and below normal body margins
    const header = repeated((line, height) => line.y > height * 0.93);
    const footer = repeated((line, height) => line.y < height * 0.07);
    const repeating = new Set([...header.keys, ...footer.keys]);

    let margins: { top: number; right: number; bottom: number; left: number } | null = null;
    if (this.page) {
      const body = this.pageLines.flatMap(({ lines }) =>
        lines.filter((line) => !repeating.has(normalizeRepeat(line.text))),
      );
      if (body.length) {
        const round = (value: number) => Math.max(0, Math.round(value * 10) / 10);
        margins = {
          top: round(this.page.heightPt - Math.max(...body.map((line) => line.y + line.size))),
          right: round(this.page.widthPt - Math.max(...body.map((line) => line.x1))),
          bottom: round(Math.min(...body.map((line) => line.y))),
          left: round(Math.min(...body.map((line) => line.x0))),
        };
      }
    }

    return {
      source: "pdf",
      page: this.page ? { ...this.page, marginsPt: margins } : null,
      textStyles: this.tally.textStyles(),
      fills: this.tally.fillList(),
      tables: null,
      images: this.images,
      rules: this.rules,
      header: header.labels,
      footer: footer.labels,
      pagesMeasured: pages,
    };
  }
}
