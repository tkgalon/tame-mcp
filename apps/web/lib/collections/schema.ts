import { z } from "zod";

export const COLLECTION_PAGE_SIZE = 20;
export const MAX_COLLECTION_PAGE = 10_000;

export const collectionNameSchema = z.string().trim().min(1).max(120)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value));

export const collectionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});

export const collectionListSchema = z.array(collectionSchema);
export type Collection = z.infer<typeof collectionSchema>;

export type CollectionActionState = {
  status: "idle" | "error";
  message: string;
};

export const initialCollectionState: CollectionActionState = { status: "idle", message: "" };

export function readCollectionPage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= MAX_COLLECTION_PAGE ? page : 1;
}
