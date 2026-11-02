"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "../../lib/action";
import { publicConfig } from "../../lib/env";
import { createSessionClient } from "../../lib/supabase";
import { afterSignIn } from "../oauth/consent/path";

const credentialsSchema = z.object({
  email: z.email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
});

function readCredentials(form: FormData) {
  return credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
}

export async function signIn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const credentials = readCredentials(form);
  if (!credentials.success) return { status: "error", message: "Enter your email and password." };
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);
  if (error) return { status: "error", message: "Unable to sign in. Check your email and password." };
  redirect(afterSignIn(form.get("authorizationId")));
}

export async function signUp(_previous: ActionState, form: FormData): Promise<ActionState> {
  const credentials = readCredentials(form);
  if (!credentials.success) {
    return { status: "error", message: "Enter a valid email and a password of 8 to 128 characters." };
  }
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials.data,
    options: { emailRedirectTo: `${publicConfig().siteUrl}/auth/callback` },
  });
  if (error) return { status: "error", message: "Unable to create the account. Try again later." };
  if (data.session) redirect(afterSignIn(form.get("authorizationId")));
  return { status: "success", message: "Check your email to confirm the account, then sign in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
