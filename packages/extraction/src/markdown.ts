import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ExtractionResult, ExtractionWarning } from "@tame/contracts";
import { buildExtraction, decodeDocument, extractionFailure, limitHeading } from "./core.js";
import type { ExtractionBlock } from "./core.js";

export const MARKDOWN_PARSER_VERSION = "markdown-v1";
const processor = unified().use(remarkParse).freeze();
type MarkdownNode = { type: string; children?: MarkdownNode[] };

export function parseMarkdownDocument(bytes: Uint8Array): ExtractionResult {
  const decoded = decodeDocument(bytes, MARKDOWN_PARSER_VERSION);
  if (!decoded.ok) return decoded.result;
  const document = decoded.document;
  const warnings = new Set<ExtractionWarning>();
  try {
    const root = processor.parse(document.text);
    const pending: MarkdownNode[] = [root];
    while (pending.length) {
      const node = pending.pop();
      if (!node) break;
      if (node.type === "image" || node.type === "imageReference") warnings.add("images_not_extracted");
      if (node.type === "html") warnings.add("html_preserved");
      if (node.children) for (const child of node.children) pending.push(child);
    }

    const blocks: ExtractionBlock[] = [];
    const headings: string[] = [];
    let start = 0;
    let heading: string | null = null;
    for (const node of root.children) {
      if (node.type !== "heading") continue;
      const offset = node.position?.start.offset;
      if (typeof offset !== "number") return extractionFailure(document, "parser_error", warnings);
      if (offset > start) blocks.push({ start, end: offset, heading });
      headings.length = node.depth;
      headings[node.depth - 1] = limitHeading(toString(node), warnings) ?? "";
      heading = limitHeading(headings.filter(Boolean).join(" / "), warnings);
      start = offset;
    }
    blocks.push({ start, end: document.text.length, heading });
    return buildExtraction(document, blocks, warnings);
  } catch {
    return extractionFailure(document, "parser_error", warnings);
  }
}
