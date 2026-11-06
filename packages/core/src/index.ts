import { hasAccess, isSessionActive, removeAccountFiles, requireAccess } from "./account.js";
import { createCollection, deleteCollection, getCollection, listCollections } from "./collections.js";
import type { CoreContext } from "./context.js";
import {
  createUploadUrl,
  deleteDocument,
  extractUploadedDocument,
  listDocuments,
  registerUpload,
} from "./documents.js";
import { exampleFile, listExamples, readExample } from "./examples.js";
import { pingDatabase } from "./health.js";
import {
  deleteDraft,
  deleteProfile,
  draftProfile,
  exportProfile,
  listDrafts,
  listProfiles,
  profileHistory,
  publishProfile,
  rollbackProfile,
  useProfile,
} from "./profiles.js";

type Bound<T> = {
  [K in keyof T]: T[K] extends (context: CoreContext, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

function bind<T extends Record<string, (context: CoreContext, ...args: never[]) => unknown>>(
  context: CoreContext,
  operations: T,
): Bound<T> {
  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [
      name,
      (...args: never[]) => operation(context, ...args),
    ]),
  ) as Bound<T>;
}

// Every operation takes the owner ID first. Callers pass the ID from a verified session or token.
export function createCore(context: CoreContext) {
  return {
    collections: bind(context, {
      list: listCollections,
      get: getCollection,
      create: createCollection,
      remove: deleteCollection,
    }),
    documents: bind(context, {
      list: listDocuments,
      registerUpload,
      createUploadUrl,
      extract: extractUploadedDocument,
      remove: deleteDocument,
    }),
    examples: bind(context, { list: listExamples, read: readExample, file: exampleFile }),
    profiles: bind(context, {
      use: useProfile,
      draft: draftProfile,
      publish: publishProfile,
      history: profileHistory,
      rollback: rollbackProfile,
      list: listProfiles,
      export: exportProfile,
      remove: deleteProfile,
      listDrafts,
      removeDraft: deleteDraft,
    }),
    account: bind(context, { hasAccess, requireAccess, isSessionActive, removeFiles: removeAccountFiles }),
    health: bind(context, { ping: pingDatabase }),
  };
}

export type Core = ReturnType<typeof createCore>;
export type { CoreContext, Extractor } from "./context.js";
export { createDatabase } from "./db/client.js";
export type { Database } from "./db/client.js";
export type { FileStore } from "./files.js";
export { TameError } from "./errors.js";
export type { TameErrorCode } from "./errors.js";
export { WORKING_RULES } from "./profiles.js";
export type { DocumentSummary } from "./documents.js";
