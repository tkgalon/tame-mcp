"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/session";
import { createSessionClient } from "../../../lib/supabase";

// Supabase marks the consent revoked and deletes the app's sessions, which MCP checks on every request
export async function revokeConnection(form: FormData): Promise<void> {
  await requireUser();
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId: String(form.get("clientId") ?? "") });
  if (error) throw new Error("Unable to revoke access. Try again.");
  revalidatePath("/connections");
}
