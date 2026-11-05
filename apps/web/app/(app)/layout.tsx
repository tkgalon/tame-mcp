import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell";
import { requireUser } from "../../lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}
