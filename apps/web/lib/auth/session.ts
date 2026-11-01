import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { readAuthConfig } from "./config";

export const getAuthenticatedUser = cache(async () => {
  if (!readAuthConfig()) return null;
  const supabase = await createSupabaseServerClient({ readOnly: true });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
