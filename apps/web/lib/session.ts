import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSessionClient } from "./supabase";

export const getUser = cache(async () => {
  const supabase = await createSessionClient({ readOnly: true });
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
