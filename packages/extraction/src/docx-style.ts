import { strFromU8 } from "fflate";
import type { DocumentStyle } from "@tame/contracts";
import { shortSample, StyleTally } from "./style.js";

type Token =
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; value: string };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

// OOXML parts are machine written, so a tag scanner is enough and avoids a full XML dependency
function* tokens(xml: string): Generator<Token> {
  const pattern = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|<[?!][^>]*>|([^<]+)/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[5] !== undefined) {
      yield { kind: "text", value: decode(match[5]) };
      continue;
    }
    if (!match[2]) continue;
    if (match[1]) {
      yield { kind: "close", name: match[2] };
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attr of (match[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      attrs[attr[1]!] = decode(attr[2]!);
    }
    yield { kind: "open", name: match[2], attrs, selfClosing: match[4] === "/" };
  }
}

type Maybe<T> = T | undefined;
type RunProps = {
  font?: Maybe<string | null>;
  sizePt?: Maybe<number | null>;
  bold?: Maybe<boolean>;
  italic?: Maybe<boolean>;
  color?: Maybe<string | null>;
  fill?: Maybe<string | null>;
};
type ParagraphProps = {
  alignment?: Maybe<DocumentStyle["textStyles"][number]["alignment"]>;
  fill?: Maybe<string | null>;
};
type StyleDefinition = { basedOn?: Maybe<string>; run: RunProps; paragraph: ParagraphProps };

const ALIGNMENT: Record<string, ParagraphProps["alignment"]> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
};

const on = (attrs: Record<string, string>) => !["0", "false", "off"].includes(attrs["w:val"] ?? "true");
const fillOf = (attrs: Record<string, string>) => {
  const fill = attrs["w:fill"];
  return fill && fill !== "auto" ? fill : null;
};

// Reads one run or paragraph property element into the props being built
function readProperty(name: string, attrs: Record<string, string>, run: RunProps, paragraph: ParagraphProps) {
  switch (name) {
    case "w:rFonts":
      run.font =
        attrs["w:ascii"] ??
        attrs["w:hAnsi"] ??
        (attrs["w:asciiTheme"] ? `theme:${attrs["w:asciiTheme"]}` : run.font);
      break;
    case "w:b":
      run.bold = on(attrs);
      break;
    case "w:i":
      run.italic = on(attrs);
      break;
    case "w:sz":
      run.sizePt = Number(attrs["w:val"]) / 2 || null;
      break;
    case "w:color":
      run.color = attrs["w:val"] && attrs["w:val"] !== "auto" ? attrs["w:val"] : null;
      break;
    case "w:jc":
      paragraph.alignment = ALIGNMENT[attrs["w:val"] ?? ""] ?? paragraph.alignment;
      break;
  }
}

function themeFonts(files: Record<string, Uint8Array>): Record<string, string> {
  const theme = files["word/theme/theme1.xml"];
  if (!theme) return {};
  const fonts: Record<string, string> = {};
  let group: "major" | "minor" | null = null;
  for (const token of tokens(strFromU8(theme))) {
    if (token.kind === "open" && (token.name === "a:majorFont" || token.name === "a:minorFont")) {
      group = token.name === "a:majorFont" ? "major" : "minor";
    } else if (token.kind === "close" && (token.name === "a:majorFont" || token.name === "a:minorFont")) {
      group = null;
    } else if (token.kind === "open" && token.name === "a:latin" && group && token.attrs["typeface"]) {
      fonts[`${group}HAnsi`] = token.attrs["typeface"];
      fonts[`${group}Ascii`] = token.attrs["typeface"];
      fonts[`${group}Bidi`] = token.attrs["typeface"];
    }
  }
  return fonts;
}

function readStyles(files: Record<string, Uint8Array>) {
  const styles = new Map<string, StyleDefinition>();
  const defaults: StyleDefinition = { run: {}, paragraph: {} };
  let defaultParagraph: string | undefined;
  const part = files["word/styles.xml"];
  if (!part) return { styles, defaults, defaultParagraph };
  let current: StyleDefinition | null = null;
  let inDefaults = false;
  for (const token of tokens(strFromU8(part))) {
    if (token.kind === "open") {
      if (token.name === "w:docDefaults") inDefaults = true;
      else if (token.name === "w:style") {
        current = { run: {}, paragraph: {} };
        const id = token.attrs["w:styleId"];
        if (id) styles.set(id, current);
        if (token.attrs["w:type"] === "paragraph" && on({ "w:val": token.attrs["w:default"] ?? "0" })) {
          defaultParagraph = id;
        }
      } else if (token.name === "w:basedOn" && current) current.basedOn = token.attrs["w:val"];
      else {
        const target = current ?? (inDefaults ? defaults : null);
        if (target) readProperty(token.name, token.attrs, target.run, target.paragraph);
        if (target && token.name === "w:shd") target.paragraph.fill = fillOf(token.attrs);
      }
    } else if (token.kind === "close") {
      if (token.name === "w:docDefaults") inDefaults = false;
      if (token.name === "w:style") current = null;
    }
  }
  return { styles, defaults, defaultParagraph };
}

function resolve(styles: Map<string, StyleDefinition>, id: string | undefined): StyleDefinition {
  const chain: StyleDefinition[] = [];
  const seen = new Set<string>();
  for (let next = id; next && !seen.has(next) && chain.length < 20;) {
    seen.add(next);
    const style = styles.get(next);
    if (!style) break;
    chain.unshift(style);
    next = style.basedOn;
  }
  return chain.reduce<StyleDefinition>(
    (merged, style) => ({
      run: { ...merged.run, ...style.run },
      paragraph: { ...merged.paragraph, ...style.paragraph },
    }),
    { run: {}, paragraph: {} },
  );
}

// Header and footer text, with page number fields shown as {page} instead of their cached value
function partText(xml: string): string[] {
  const lines: string[] = [];
  let line = "";
  let inText = false;
  let simpleFields = 0;
  const fields: { instruction: string; result: boolean }[] = [];
  const hidden = () =>
    simpleFields > 0 || fields.some((field) => field.result && /\bPAGE\b/.test(field.instruction));
  for (const token of tokens(xml)) {
    if (token.kind === "text") {
      if (inText && !hidden()) line += token.value;
      else if (!inText && fields.length) fields.at(-1)!.instruction += token.value;
      continue;
    }
    if (token.kind === "close") {
      if (token.name === "w:t") inText = false;
      else if (token.name === "w:fldSimple") simpleFields--;
      else if (token.name === "w:p") {
        const sample = shortSample(line);
        if (sample) lines.push(sample);
        line = "";
      }
      continue;
    }
    switch (token.name) {
      case "w:t":
        if (!token.selfClosing) inText = true;
        break;
      case "w:tab":
        if (!hidden()) line += " ";
        break;
      case "w:fldSimple":
        if (/\bPAGE\b/.test(token.attrs["w:instr"] ?? "")) line += "{page}";
        if (!token.selfClosing) simpleFields++;
        break;
      case "w:fldChar": {
        const type = token.attrs["w:fldCharType"];
        if (type === "begin") fields.push({ instruction: "", result: false });
        else if (type === "separate" && fields.length) {
          const field = fields.at(-1)!;
          field.result = true;
          if (/\bPAGE\b/.test(field.instruction)) line += "{page}";
        } else if (type === "end") fields.pop();
        break;
      }
    }
  }
  return lines;
}

function headerFooter(files: Record<string, Uint8Array>, kind: "header" | "footer"): string[] {
  const lines = Object.keys(files)
    .filter((name) => new RegExp(`^word/${kind}\\d*\\.xml$`).test(name))
    .sort()
    .flatMap((name) => partText(strFromU8(files[name]!)));
  return [...new Set(lines)].slice(0, 5);
}

const twips = (value: string | undefined) => (value ? Math.round((Number(value) / 20) * 10) / 10 : null);

export function measureDocxStyle(files: Record<string, Uint8Array>): DocumentStyle {
  const { styles, defaults, defaultParagraph } = readStyles(files);
  const theme = themeFonts(files);
  const fontName = (font: string | null | undefined) =>
    font?.startsWith("theme:") ? (theme[font.slice(6)] ?? null) : (font ?? null);
  const tally = new StyleTally();
  const document = strFromU8(files["word/document.xml"]!);

  let tables = 0;
  let images = 0;
  let page: DocumentStyle["page"] = null;
  let paragraph: {
    style?: Maybe<string>;
    props: ParagraphProps;
    runs: { props: RunProps; text: string }[];
  } | null = null;
  let run: { style?: Maybe<string>; props: RunProps; text: string } | null = null;
  let inText = false;
  let cell: { fill: string | null; text: string } | null = null;
  let inProperties = false;
  let inSection = false;
  let pageSize: { widthPt: number; heightPt: number } | null = null;
  let margins: { top: number; right: number; bottom: number; left: number } | null = null;

  const closeParagraph = () => {
    if (!paragraph) return;
    const base = resolve(styles, paragraph.style ?? defaultParagraph);
    const alignment =
      paragraph.props.alignment ?? base.paragraph.alignment ?? defaults.paragraph.alignment ?? null;
    const text = paragraph.runs.map((item) => item.text).join("");
    const fill = paragraph.props.fill ?? base.paragraph.fill ?? null;
    if (fill) tally.addFill(fill, shortSample(text));
    for (const item of paragraph.runs) {
      const props = { ...defaults.run, ...base.run, ...item.props };
      tally.addText({
        font: fontName(props.font),
        sizePt: props.sizePt ?? null,
        bold: props.bold ?? false,
        italic: props.italic ?? false,
        color: props.color ?? null,
        alignment,
        text: item.text,
      });
      if (props.fill) tally.addFill(props.fill, shortSample(item.text));
    }
    if (cell) cell.text += text + " ";
    paragraph = null;
  };

  // Word repeats drawings inside mc:Fallback for old readers, so that copy is skipped
  let fallbackDepth = 0;
  for (const token of tokens(document)) {
    if (token.kind !== "text" && token.name === "mc:Fallback") {
      if (token.kind === "close") fallbackDepth--;
      else if (!token.selfClosing) fallbackDepth++;
      continue;
    }
    if (fallbackDepth > 0) continue;
    if (token.kind === "text") {
      if (inText && run) run.text += token.value;
      continue;
    }
    if (token.kind === "close") {
      switch (token.name) {
        case "w:t":
          inText = false;
          break;
        case "w:r":
          if (run && paragraph) {
            const style = run.style ? resolve(styles, run.style).run : {};
            paragraph.runs.push({ props: { ...style, ...run.props }, text: run.text });
          }
          run = null;
          break;
        case "w:p":
          closeParagraph();
          break;
        case "w:rPr":
        case "w:pPr":
        case "w:tcPr":
          inProperties = false;
          break;
        case "w:tc":
          if (cell?.fill) tally.addFill(cell.fill, shortSample(cell.text));
          cell = null;
          break;
        case "w:sectPr":
          inSection = false;
          break;
      }
      continue;
    }
    const { name, attrs } = token;
    switch (name) {
      case "w:p":
        paragraph = { props: {}, runs: [] };
        break;
      case "w:r":
        run = { props: {}, text: "" };
        break;
      case "w:t":
        if (!token.selfClosing) inText = true;
        break;
      case "w:tab":
        if (run && !inProperties) run.text += " ";
        break;
      case "w:rPr":
      case "w:pPr":
      case "w:tcPr":
        if (!token.selfClosing) inProperties = true;
        break;
      case "w:pStyle":
        if (paragraph) paragraph.style = attrs["w:val"];
        break;
      case "w:rStyle":
        if (run) run.style = attrs["w:val"];
        break;
      case "w:shd":
        if (run) run.props.fill = fillOf(attrs);
        else if (paragraph) paragraph.props.fill = fillOf(attrs);
        else if (cell) cell.fill = fillOf(attrs);
        break;
      case "w:tbl":
        tables++;
        break;
      case "w:tc":
        cell = { fill: null, text: "" };
        break;
      case "w:drawing":
      case "w:pict":
        images++;
        break;
      case "w:sectPr":
        inSection = true;
        break;
      case "w:pgSz":
        if (inSection) {
          const width = twips(attrs["w:w"]);
          const height = twips(attrs["w:h"]);
          if (width && height) pageSize = { widthPt: width, heightPt: height };
        }
        break;
      case "w:pgMar":
        if (inSection) {
          margins = {
            top: twips(attrs["w:top"]) ?? 0,
            right: twips(attrs["w:right"]) ?? 0,
            bottom: twips(attrs["w:bottom"]) ?? 0,
            left: twips(attrs["w:left"]) ?? 0,
          };
        }
        break;
      default:
        if (run) readProperty(name, attrs, run.props, {});
        else if (paragraph) readProperty(name, attrs, {}, paragraph.props);
    }
  }
  if (pageSize) page = { ...pageSize, marginsPt: margins };

  return {
    source: "docx",
    page,
    textStyles: tally.textStyles(),
    fills: tally.fillList(),
    tables,
    images,
    rules: 0,
    header: headerFooter(files, "header"),
    footer: headerFooter(files, "footer"),
    pagesMeasured: 0,
  };
}
