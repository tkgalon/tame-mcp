import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "../../components/app-nav";
import { requireUser } from "../../lib/session";
import { signOut } from "../auth/actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="app-header">
        <Link href="/" className="brand">
          TAME
        </Link>
        <AppNav />
        <form action={signOut} className="account-menu">
          <span>{user.email}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
