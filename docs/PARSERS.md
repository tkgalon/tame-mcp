# Text extraction contracts

Standalone parsers support TXT, Markdown, text-based PDF, and DOCX. They do not run the worker, download Storage objects, persist sections, or change a document's database status. OCR, job leases, and retries are maybe will be implemented later, i think :)

## Entry points

```ts
import { parseTextDocument } from "@tame/parsers/text";
import { parseMarkdownDocument } from "@tame/parsers/markdown";
import { parsePdfDocument } from "@tame/parsers/pdf";
import { parseDocxDocument } from "@tame/parsers/docx";

const markdown = parseMarkdownDocument(fileBytes);
const pdf = await parsePdfDocument(pdfBytes);
const docx = await parseDocxDocument(docxBytes);
```

Inputs are byte arrays. The caller selects the parser using validated document metadata. These functions do not read file paths, access credentials, call an LLM, fetch links, render HTML, or execute commands from documents. The future worker must run parsing in a process with resource limits.

## Result

The shared `extractionResultSchema` in `@tame/contracts` validates:

- `ready`: content hash, parser version, warnings, and nonempty ordered sections.
- `failed`: content hash, parser version, warnings, and a machine-readable error code. No partial sections are returned.
- `needs_ocr`: no extractable PDF text, with `no_extractable_text` and no partial sections. This is a candidate for OCR, not proof that the file is a scan. Blank and vector-only PDFs receive the same result.
- `unsupported`: a reserved result for an unsupported media type. These entry points do not dispatch unsupported formats.

Each section has `ordinal`, `content`, nullable `heading` and `page`, and `sourceStart` / `sourceEnd`. Page is null for TXT and Markdown.

The content hash is SHA-256 of the original bytes. Source offsets are UTF-16 indices into the extraction text, not byte offsets into the original file. Concatenating sections reconstructs this text exactly.

For TXT and Markdown, extraction text is the normalized source: UTF-8 BOM is removed and CRLF/CR line endings become LF. Indentation, blank lines, code, and remaining whitespace are retained. PDF and DOCX extraction is a conversion with approximate layout, not preservation of the original source.

## Limits and warnings

| Limit | Value |
| --- | --- |
| Input file | 10 MiB |
| Normalized document | 100,000 Unicode code points |
| Section | 8,000 Unicode code points |
| Heading metadata | 500 Unicode code points |
| Number of sections | 1,000 |
| PDF pages | 200 |
| PDF text items across pages | 100,000 |
| DOCX ZIP entries | 1,000 |
| Expanded DOCX entry | 8 MiB |
| Total expanded DOCX | 32 MiB |
| Intermediate DOCX HTML | 2,000,000 UTF-16 units |
| Converted DOCX HTML nodes | 100,000 |

Byte, text, and section-count overflow fail extraction instead of silently truncating content. Heading metadata may be shortened with a warning, while its full source remains in section content. Long blocks may split across sections with `section_split`.

Markdown uses the CommonMark AST to identify top-level headings, including Setext headings. Fenced code is preserved and is not mistaken for headings. Heading metadata carries ancestor context. Markdown syntax remains in content, including links, list markers, and tables. It is not converted to rendered HTML or stripped into a lossy plain-text representation.

Images generate `images_not_extracted`. Their references and alt text remain in source but their pixels are not read. Raw HTML generates `html_preserved` and remains untrusted text. GFM tables and frontmatter are retained as source, without dedicated semantic parsing. No network requests or embedded scripts are executed.

Invalid UTF-8, binary control characters, whitespace-only documents, and a recognizable PDF header passed to a text parser fail explicitly. Successful extraction does not prove a document is safe or that it is a good example for learning a profile.

## PDF

PDF.js extracts the existing text layer, one page at a time. Sections retain original page numbers. Headings are not inferred. `layout_approximate` is always present because columns, equations, code indentation, and visual reading order may be reconstructed imperfectly. Pages without text are omitted with `pages_without_text`; a PDF with no text at all returns `needs_ocr`. In a mixed PDF, the warning means image-only pages still need separate handling.

The parser takes a copy of input bytes so PDF.js cannot detach the caller's array. It does not render pages, invoke document JavaScript, follow links, or supply external resource URLs. Complex fonts requiring missing CMaps or incorrect character maps can still produce incomplete or inaccurate text. This milestone does not assess text-layer quality or run OCR.

Password-protected PDFs return `password_required`. Malformed PDFs return `invalid_document`. Page, text-item, and extracted-text limits fail without partial sections. PDF.js may allocate a whole page's text and internal objects before these checks, so these are output/work budgets rather than hard memory or CPU limits.

## DOCX

A lazy ZIP preflight validates entry names, duplicates, compression, encryption flags, entry count, declared sizes, and actual expanded bytes. It rejects unsafe paths and does not extract files to disk. Validated entries are repacked into a canonical ZIP before conversion so the converter sees the same entries that passed validation.

Mammoth converts this archive with external file access and embedded style maps disabled. Image bytes are not read by its image converter. parse5 then traverses the resulting HTML as data, without rendering it. The result retains standard headings, paragraphs, list labels, table cell text, and image alt text when available. Hyperlink labels are retained, but targets are omitted. Images produce `images_not_extracted`.

`layout_approximate` is always present. Page numbers are null because no Word layout engine runs. List numbering is normalized; custom numbering, headers, footers, text boxes, equations, tracked changes, and complex layouts are not guaranteed to survive. Nonfatal converter messages produce `conversion_warning`; raw library messages and document content are not returned in errors. DOCX is supported, while legacy `.doc` and encrypted Office compound files are not.

DOCX decompression and conversion still allocate memory within these limits. Both binary parsers must run in a separate worker process with enforced time/memory limits before accepting untrusted production uploads. That integration is not included here.

Library references: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [Mammoth security and options](https://github.com/mwilliamson/mammoth.js), [yauzl ZIP validation](https://github.com/thejoshwolfe/yauzl).

## Verify

```bash
npx pnpm@10.34.9 test:parsers
npx pnpm@10.34.9 check
```

Synthetic fixtures cover source preservation, headings, Unicode, actual PDF text/images, encryption, page and text budgets, DOCX tables and numbering, ZIP expansion limits, malformed archives, duplicate/traversal names, and untrusted references. Database integration and worker isolation are not covered by this milestone.
