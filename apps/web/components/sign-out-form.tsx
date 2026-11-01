"use client";

import { useActionState } from "react";
import { signOutAction } from "../app/auth/actions";
import { initialAuthState } from "../lib/auth/form";

export function SignOutForm() {
  const [state, action, pending] = useActionState(signOutAction, initialAuthState);
  return (
    <form action={action}>
      <button disabled={pending} type="submit">{pending ? "Signing out…" : "Sign out"}</button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  );
}
