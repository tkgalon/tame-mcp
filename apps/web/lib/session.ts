import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCore } from "./core";
import { createSessionClient } from "./supabase";

export const getUser = cache(async () => {
  const supabase = await createSessionClient({ readOnly: true });
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export const hasAccess = cache((userId: string) => getCore().account.hasAccess(userId));

// Pages and actions behind this need a signed-in account that the owner approved
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!(await hasAccess(user.id))) redirect("/pending");
  return user;
}
