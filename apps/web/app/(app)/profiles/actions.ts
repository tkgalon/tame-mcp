"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";

export async function deleteProfile(form: FormData): Promise<void> {
  const user = await requireUser();
  await getCore().profiles.remove(user.id, String(form.get("id") ?? ""));
  redirect("/profiles");
}

export async function deleteDraft(form: FormData): Promise<void> {
  const user = await requireUser();
  await getCore().profiles.removeDraft(user.id, String(form.get("id") ?? ""));
  revalidatePath("/profiles");
}
