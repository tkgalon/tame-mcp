import yauzl from "yauzl";
import { zipSync } from "fflate";
import { ExtractionInputError } from "./binary.js";

export const MAX_DOCX_ENTRIES = 1_000;
export const MAX_DOCX_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_DOCX_EXPANDED_BYTES = 32 * 1024 * 1024;

export async function boundedDocxArchive(bytes: Uint8Array): Promise<Buffer> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (error || !archive) reject(new ExtractionInputError("invalid_document"));
      else resolve(archive);
    });
  });
  return new Promise((resolve, reject) => {
    const files: Record<string, Uint8Array> = Object.create(null);
    const names = new Set<string>();
    let entries = 0;
    let expandedBytes = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error instanceof ExtractionInputError ? error : new ExtractionInputError("invalid_document"));
    };
    zip.on("error", fail);
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        if (++entries > MAX_DOCX_ENTRIES) throw new ExtractionInputError("archive_limit_exceeded");
        const name = entry.fileName;
        if (names.has(name) || name.split("/").some(part => part === ".." || part === ".") || /[\\\u0000-\u001f]/.test(name)) {
          throw new ExtractionInputError("invalid_document");
        }
        names.add(name);
        if (entry.generalPurposeBitFlag & 1) throw new ExtractionInputError("password_required");
        if (![0, 8].includes(entry.compressionMethod)) throw new ExtractionInputError("invalid_document");
        if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES || expandedBytes + entry.uncompressedSize > MAX_DOCX_EXPANDED_BYTES) {
          throw new ExtractionInputError("archive_limit_exceeded");
        }
        const stream = await new Promise<NodeJS.ReadableStream>((accept, decline) => {
          zip.openReadStream(entry, (error, value) => error || !value ? decline(error) : accept(value));
        });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk);
          size += buffer.byteLength;
          expandedBytes += buffer.byteLength;
          if (size > MAX_DOCX_ENTRY_BYTES || expandedBytes > MAX_DOCX_EXPANDED_BYTES) {
            throw new ExtractionInputError("archive_limit_exceeded");
          }
          chunks.push(buffer);
        }
        if (!name.endsWith("/")) files[name] = Buffer.concat(chunks);
        if (!settled) zip.readEntry();
      })().catch(fail);
    });
    zip.on("end", () => {
      if (settled) return;
      if (!["[Content_Types].xml", "_rels/.rels", "word/document.xml"].every(name => files[name])) {
        fail(new ExtractionInputError("invalid_document"));
        return;
      }
      try {
        // Repack the validated bytes so the converter cannot interpret a different ZIP directory.
        const canonical = zipSync(files, { level: 0 });
        settled = true;
        resolve(Buffer.from(canonical));
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}
