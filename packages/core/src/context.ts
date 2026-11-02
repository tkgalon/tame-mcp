import type { ExtractionResult } from "@tame/contracts";
import type { Database } from "./db/client.js";
import type { FileStore } from "./files.js";

export type Extractor = (bytes: Uint8Array, mediaType: string) => Promise<ExtractionResult>;

export type CoreContext = {
  db: Database;
  files: FileStore;
  extract: Extractor;
};
