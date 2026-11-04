import mammoth from "mammoth";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { currentParserVersion, documentStyleSchema } from "@tame/contracts";
import type { DocumentStyle, ExtractionResult, ExtractionWarning } from "@tame/contracts";
import { binaryDocument, ExtractionInputError, TextBudget } from "./binary.js";
import { boundedDocxArchive } from "./docx-archive.js";
import { buildExtraction, extractionFailure, limitHeading } from "./core.js";
import type { ExtractionBlock } from "./core.js";
import { measureDocxStyle } from "./docx-style.js";

export const DOCX_PARSER_VERSION = currentParserVersion(
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);
const MAX_HTML_CHARACTERS = 2_000_000;
const MAX_HTML_NODES = 100_000;
const BLOCK_TAGS = ["p", "li", "pre", "blockquote"];

export async function parseDocxDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  const { base, tooLarge } = binaryDocument(bytes, DOCX_PARSER_VERSION);
  if (tooLarge) return extractionFailure(base, "file_too_large");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return extractionFailure(base, "format_mismatch");
  const warnings = new Set<ExtractionWarning>(["layout_approximate"]);
  try {
    const archive = await boundedDocxArchive(bytes);
    const converted = await mammoth.convertToHtml(
      { buffer: archive.buffer },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        convertImage: mammoth.images.imgElement(async () => {
          warnings.add("images_not_extracted");
          return { src: "" };
        }),
      },
    );
    if (converted.messages.some((message) => message.type === "error"))
      throw new ExtractionInputError("invalid_document");
    if (converted.messages.length) warnings.add("conversion_warning");
    if (converted.value.length > MAX_HTML_CHARACTERS) throw new ExtractionInputError("text_limit_exceeded");
    const root = parseFragment(converted.value);
    const text = new TextBudget();
    const blocks: ExtractionBlock[] = [];
    let heading: string | null = null;
    let blockStart = 0;
    let visited = 0;
    let images = 0;
    let headingDepth = 0;
    let boldDepth = 0;
    type Node = DefaultTreeAdapterMap["node"];
    type Event = { node: Node; exit: boolean; headingStart?: number; boldStart?: number };
    const stack: Event[] = [...root.childNodes].reverse().map((node) => ({ node, exit: false }));
    const lists: Array<{ ordered: boolean; next: number }> = [];
    // Tables become Markdown rows so agents see which values sit in the same row
    const tables: Array<{ rows: number; cells: number }> = [];
    let cellDepth = 0;
    const newline = () => {
      if (text.text && !text.text.endsWith("\n")) text.append("\n");
    };
    const blockBreak = () => {
      if (cellDepth === 0) newline();
      else if (!/[\s|]$/.test(text.text)) text.append(" ");
    };
    while (stack.length) {
      const event = stack.pop()!;
      const node = event.node;
      if (!event.exit && ++visited > MAX_HTML_NODES)
        throw new ExtractionInputError("complexity_limit_exceeded");
      if ("value" in node && node.nodeName === "#text") {
        text.append(cellDepth > 0 ? node.value.replace(/\|/g, "\\|").replace(/\n/g, " ") : node.value);
        continue;
      }
      if (!("tagName" in node)) continue;
      const tag = node.tagName;
      if (["script", "style"].includes(tag)) continue;
      const isHeading = /^h[1-6]$/.test(tag);
      const table = tables.at(-1);
      if (event.exit) {
        if (isHeading) {
          headingDepth--;
          heading = limitHeading(text.text.slice(event.headingStart).trim(), warnings);
        }
        if (event.boldStart !== undefined) {
          boldDepth--;
          const inner = text.text.slice(event.boldStart);
          if (!inner.trim()) text.truncate(event.boldStart - 2);
          else {
            const trailing = /\s*$/.exec(inner)?.[0] ?? "";
            text.truncate(text.text.length - trailing.length);
            text.append(`**${trailing}`);
          }
        }
        if (BLOCK_TAGS.includes(tag) || isHeading) blockBreak();
        if (["td", "th"].includes(tag) && table) {
          cellDepth--;
          text.truncate(text.text.replace(/ +$/, "").length);
          text.append(" |");
          table.cells++;
        }
        if (tag === "tr" && table) {
          newline();
          if (table.rows++ === 0) text.append(`|${" --- |".repeat(Math.max(table.cells, 1))}\n`);
        }
        if (tag === "table") tables.pop();
        if (["ol", "ul"].includes(tag)) lists.pop();
        continue;
      }
      let boldStart: number | undefined;
      if (isHeading) {
        newline();
        if (text.text.length > blockStart) blocks.push({ start: blockStart, end: text.text.length, heading });
        blockStart = text.text.length;
        headingDepth++;
      }
      if (BLOCK_TAGS.includes(tag)) blockBreak();
      if (tag === "table") {
        newline();
        tables.push({ rows: 0, cells: 0 });
      }
      if (tag === "tr" && table) {
        newline();
        text.append("|");
        table.cells = 0;
      }
      if (["td", "th"].includes(tag) && table) {
        cellDepth++;
        text.append(" ");
      }
      if (tag === "strong" && headingDepth === 0 && boldDepth === 0) {
        boldDepth++;
        text.append("**");
        boldStart = text.text.length;
      }
      if (["ol", "ul"].includes(tag)) lists.push({ ordered: tag === "ol", next: 1 });
      if (tag === "li") {
        const list = lists.at(-1);
        text.append(list?.ordered ? `${list.next++}. ` : "- ");
      }
      if (tag === "br") {
        if (cellDepth > 0) text.append(" ");
        else text.append("\n");
      }
      if (tag === "img") {
        warnings.add("images_not_extracted");
        const alt = node.attrs.find((attribute) => attribute.name === "alt")?.value;
        text.append(`[Image ${++images}${alt ? `: ${alt}` : ""}]`);
      }
      stack.push({
        node,
        exit: true,
        ...(isHeading ? { headingStart: text.text.length } : {}),
        ...(boldStart !== undefined ? { boldStart } : {}),
      });
      for (const child of [...node.childNodes].reverse()) stack.push({ node: child, exit: false });
    }
    if (!text.text.trim()) return extractionFailure(base, "empty_document", warnings);
    if (text.text.length > blockStart) blocks.push({ start: blockStart, end: text.text.length, heading });
    const result = buildExtraction({ ...base, text: text.text }, blocks, warnings);
    if (result.status !== "ready") return result;
    const style = measureStyle(archive.files);
    return style ? { ...result, style } : result;
  } catch (error) {
    return extractionFailure(
      base,
      error instanceof ExtractionInputError ? error.code : "invalid_document",
      warnings,
    );
  }
}

// The text is the main result, so an unexpected layout only drops the style summary
function measureStyle(files: Record<string, Uint8Array>): DocumentStyle | null {
  try {
    return documentStyleSchema.safeParse(measureDocxStyle(files)).data ?? null;
  } catch {
    return null;
  }
}
