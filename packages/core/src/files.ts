// Storage is injected so core stays independent of the Supabase SDK and tests can use memory
export interface FileStore {
  createUploadUrl(path: string): Promise<string>;
  download(path: string): Promise<Uint8Array | null>;
  createDownloadUrl(path: string, fileName: string, expiresInSeconds: number): Promise<string>;
  remove(paths: string[]): Promise<void>;
}
