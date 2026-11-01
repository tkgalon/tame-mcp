import mammoth from "mammoth";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { ExtractionResult, ExtractionWarning } from "@tame/contracts";
import { binaryDocument, ExtractionInputError, TextBudget } from "./binary.js";
import { boundedDocxArchive } from "./docx-archive.js";
import { buildExtraction, extractionFailure, limitHeading } from "./core.js";
import type { ExtractionBlock } from "./core.js";

export const DOCX_PARSER_VERSION = "docx-v1";
const MAX_HTML_CHARACTERS = 2_000_000;
const MAX_HTML_NODES = 100_000;

export async function parseDocxDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  const { base, tooLarge } = binaryDocument(bytes, DOCX_PARSER_VERSION);
  if (tooLarge) return extractionFailure(base, "file_too_large");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return extractionFailure(base, "format_mismatch");
  const warnings = new Set<ExtractionWarning>(["layout_approximate"]);
  try {
    const buffer = await boundedDocxArchive(bytes);
    const converted = await mammoth.convertToHtml({ buffer }, {
      externalFileAccess: false, includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async () => {
        warnings.add("images_not_extracted");
        return { src: "" };
      }),
    });
    if (converted.messages.some(message => message.type === "error")) throw new ExtractionInputError("invalid_document");
    if (converted.messages.length) warnings.add("conversion_warning");
    if (converted.value.length > MAX_HTML_CHARACTERS) throw new ExtractionInputError("text_limit_exceeded");
    const root = parseFragment(converted.value);
    const text = new TextBudget();
    const blocks: ExtractionBlock[] = [];
    let heading: string | null = null;
    let blockStart = 0;
    let visited = 0;
    type Node = DefaultTreeAdapterMap["node"];
    type Event = { node: Node; exit: boolean; headingStart?: number };
    const stack: Event[] = [...root.childNodes].reverse().map(node => ({ node, exit: false }));
    const lists: Array<{ ordered: boolean; next: number }> = [];
    const newline = () => { if (text.text && !text.text.endsWith("\n")) text.append("\n"); };
    while (stack.length) {
      const event = stack.pop()!;
      const node = event.node;
      if (!event.exit && ++visited > MAX_HTML_NODES) throw new ExtractionInputError("complexity_limit_exceeded");
      if ("value" in node && node.nodeName === "#text") { text.append(node.value); continue; }
      if (!("tagName" in node)) continue;
      const tag = node.tagName;
      if (["script", "style"].includes(tag)) continue;
      const isHeading = /^h[1-6]$/.test(tag);
      if (event.exit) {
        if (isHeading) heading = limitHeading(text.text.slice(event.headingStart).trim(), warnings);
        if (["p", "li", "tr", "pre", "blockquote"].includes(tag) || isHeading) newline();
        if (["td", "th"].includes(tag)) text.append("\t");
        if (["ol", "ul"].includes(tag)) lists.pop();
        continue;
      }
      if (isHeading) {
        newline();
        if (text.text.length > blockStart) blocks.push({ start: blockStart, end: text.text.length, heading });
        blockStart = text.text.length;
      }
      if (["p", "li", "tr", "pre", "blockquote"].includes(tag)) newline();
      if (["ol", "ul"].includes(tag)) lists.push({ ordered: tag === "ol", next: 1 });
      if (tag === "li") {
        const list = lists.at(-1);
        text.append(list?.ordered ? `${list.next++}. ` : "- ");
      }
      if (tag === "br") text.append("\n");
      if (tag === "img") {
        warnings.add("images_not_extracted");
        const alt = node.attrs.find(attribute => attribute.name === "alt")?.value;
        if (alt) text.append(`[Image: ${alt}]`);
      }
      stack.push({ node, exit: true, ...(isHeading ? { headingStart: text.text.length } : {}) });
      for (const child of [...node.childNodes].reverse()) stack.push({ node: child, exit: false });
    }
    if (!text.text.trim()) return extractionFailure(base, "empty_document", warnings);
    if (text.text.length > blockStart) blocks.push({ start: blockStart, end: text.text.length, heading });
    return buildExtraction({ ...base, text: text.text }, blocks, warnings);
  } catch (error) {
    return extractionFailure(base, error instanceof ExtractionInputError ? error.code : "invalid_document", warnings);
  }
}
