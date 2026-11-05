import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "../app/auth/actions";
import { AppNav } from "./app-nav";
import { TameMark } from "./tame-mark";

export function AppShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="ta">
      <header className="nav">
        <div className="nav-in">
          <Link className="logo glass" href="/">
            <TameMark />
            TAME
          </Link>
          <AppNav />
          <form action={signOut} className="acct glass">
            <span className="who">{email}</span>
            <span className="avatar" aria-hidden="true">
              {email.charAt(0).toUpperCase() || "?"}
            </span>
            <button className="btn sm ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
