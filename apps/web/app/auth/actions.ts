"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { readAuthConfig } from "../../lib/auth/config";
import { readCredentials } from "../../lib/auth/form";
import type { AuthActionState } from "../../lib/auth/form";

const unavailable: AuthActionState = {
  status: "error",
  message: "Authentication is unavailable. Check the server configuration and try again.",
};

export async function signInAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!readAuthConfig()) return unavailable;
  const credentials = readCredentials(formData, "sign-in");
  if (!credentials) return { status: "error", message: "Enter a valid email address and password." };
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { status: "error", message: "Unable to sign in. Check your credentials or try again later." };
  } catch {
    return unavailable;
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUpAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const config = readAuthConfig();
  if (!config) return unavailable;
  const credentials = readCredentials(formData, "sign-up");
  if (!credentials) return { status: "error", message: "Enter a valid email address and a password of 8 to 128 characters." };
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      ...credentials,
      options: { emailRedirectTo: `${config.siteUrl}/auth/callback` },
    });
    if (error) return { status: "error", message: "Unable to create an account. Try again later or sign in if you already have one." };
    signedIn = Boolean(data.session);
  } catch {
    return unavailable;
  }
  if (signedIn) {
    revalidatePath("/", "layout");
    redirect("/");
  }
  return { status: "success", message: "If confirmation is required, check your email to continue. You can sign in once your account is ready." };
}

export async function signOutAction(_previous: AuthActionState, _formData: FormData): Promise<AuthActionState> {
  if (!readAuthConfig()) return unavailable;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { status: "error", message: "Unable to sign out. Try again." };
  } catch {
    return unavailable;
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
