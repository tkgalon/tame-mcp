"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "../../../lib/action";
import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";
import { createAdminClient, createSessionClient } from "../../../lib/supabase";

export async function deleteAccount(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const typed = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase()) {
    return { status: "error", message: "Type the email of this account to confirm." };
  }
  try {
    await getCore().account.removeFiles(user.id);
    const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch {
    return { status: "error", message: "The account could not be deleted. Try again." };
  }
  await (await createSessionClient()).auth.signOut({ scope: "local" });
  redirect("/login");
}
