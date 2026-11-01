# Text extraction contracts

This milestone provides standalone TXT and Markdown parsers. It does not run the worker, download Storage objects, persist sections, or change a document's database status. PDF, DOCX, OCR, job leases, and retries are separate milestones.

## Entry points

```ts
import { parseTextDocument } from "@tame/parsers/text";
import { parseMarkdownDocument } from "@tame/parsers/markdown";

const result = parseMarkdownDocument(fileBytes);
```

Inputs are byte arrays. The caller selects the parser using validated document metadata. These functions do not read file paths, access credentials, call an LLM, fetch links, render HTML, or execute commands from documents. The future worker must run parsing in a process with resource limits.

## Result

The shared `extractionResultSchema` in `@tame/contracts` validates:

- `ready`: content hash, parser version, warnings, and nonempty ordered sections.
- `failed`: content hash, parser version, warnings, and a machine-readable error code. No partial sections are returned.
- `unsupported`: a reserved result for an unsupported media type. These two entry points do not dispatch unsupported formats.

Each section has `ordinal`, `content`, nullable `heading` and `page`, and `sourceStart` / `sourceEnd`. Page is null for TXT and Markdown.

The content hash is SHA-256 of the original bytes. Source offsets are UTF-16 indices into normalized text, not byte offsets into the original file. UTF-8 BOM is removed and CRLF/CR line endings become LF. Indentation, blank lines, code, and remaining whitespace are retained. Concatenating the sections reconstructs the normalized source exactly.

## Limits and warnings

| Limit | Value |
| --- | --- |
| Input file | 10 MiB |
| Normalized document | 100,000 Unicode code points |
| Section | 8,000 Unicode code points |
| Heading metadata | 500 Unicode code points |
| Number of sections | 1,000 |

Byte, text, and section-count overflow fail extraction instead of silently truncating content. Heading metadata may be shortened with a warning, while its full source remains in section content. Long blocks may split across sections with `section_split`.

Markdown uses the CommonMark AST to identify top-level headings, including Setext headings. Fenced code is preserved and is not mistaken for headings. Heading metadata carries ancestor context. Markdown syntax remains in content, including links, list markers, and tables. It is not converted to rendered HTML or stripped into a lossy plain-text representation.

Images generate `images_not_extracted`. Their references and alt text remain in source but their pixels are not read. Raw HTML generates `html_preserved` and remains untrusted text. GFM tables and frontmatter are retained as source, without dedicated semantic parsing. No network requests or embedded scripts are executed.

Invalid UTF-8, binary control characters, whitespace-only documents, and a recognizable PDF header passed to a text parser fail explicitly. Successful extraction does not prove a document is safe or that it is a good example for learning a profile.

## Verify

```bash
npx pnpm@10.34.9 test:parsers
npx pnpm@10.34.9 check
```

Tests cover source preservation, code blocks, heading hierarchy, Unicode boundaries, limits, failure states, and untrusted image/HTML references. Database integration and worker isolation are not covered by this milestone.
