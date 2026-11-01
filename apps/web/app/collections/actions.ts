"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../../lib/auth/session";
import { createCollection } from "../../lib/collections/data";
import { collectionNameSchema } from "../../lib/collections/schema";
import type { CollectionActionState } from "../../lib/collections/schema";

export async function createCollectionAction(
  _previous: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const user = await requireUser();
  const parsed = collectionNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { status: "error", message: "Enter a collection name of 1 to 120 characters without control characters." };
  }

  try {
    await createCollection(user.id, parsed.data);
  } catch {
    return { status: "error", message: "Unable to create the collection. Try again." };
  }
  revalidatePath("/collections");
  redirect("/collections");
}
