import "server-only";
import { createCore, createDatabase } from "@tame/core";
import type { Core, FileStore } from "@tame/core";
import { extractDocument } from "@tame/extraction";
import { serverConfig } from "./env";
import { createAdminClient } from "./supabase";

const BUCKET = "documents";

function supabaseFiles(): FileStore {
  const storage = () => createAdminClient().storage.from(BUCKET);
  return {
    async createUploadUrl(path) {
      const { data, error } = await storage().createSignedUploadUrl(path, { upsert: false });
      if (error) throw new Error("Unable to prepare the upload.");
      return data.signedUrl;
    },
    async download(path) {
      const { data, error } = await storage().download(path);
      if (error) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await storage().remove(paths);
      if (error) throw new Error("Unable to remove stored files. Try again.");
    },
  };
}

// One pool per server process, reused across requests and hot reloads
const globalCore = globalThis as unknown as { tameCore?: Core };

export function getCore(): Core {
  globalCore.tameCore ??= createCore({
    db: createDatabase(serverConfig().databaseUrl),
    files: supabaseFiles(),
    extract: extractDocument,
  });
  return globalCore.tameCore;
}
