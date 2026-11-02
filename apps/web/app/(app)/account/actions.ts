"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { ActionState } from "../../../lib/action";
import { getCore } from "../../../lib/core";
import { publicConfig } from "../../../lib/env";
import { requireUser } from "../../../lib/session";
import { createAdminClient, createSessionClient } from "../../../lib/supabase";

// The password is checked with a separate client so the current session cookies stay untouched
async function passwordMatches(email: string, password: string) {
  const config = publicConfig();
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

export async function deleteAccount(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const password = String(form.get("password") ?? "");
  if (!user.email || !(await passwordMatches(user.email, password))) {
    return { status: "error", message: "The password is not correct." };
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
