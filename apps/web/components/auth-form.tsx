"use client";

import { useActionState } from "react";
import { signIn, signUp } from "../app/auth/actions";
import { idle } from "../lib/action-state";

export function AuthForm({
  mode,
  authorizationId,
}: {
  mode: "sign-in" | "sign-up";
  authorizationId: string | null;
}) {
  const signingUp = mode === "sign-up";
  const [state, action, pending] = useActionState(signingUp ? signUp : signIn, idle);
  return (
    <form action={action}>
      {authorizationId && <input type="hidden" name="authorizationId" value={authorizationId} />}
      <fieldset disabled={pending}>
        <legend>{signingUp ? "Create an account" : "Sign in"}</legend>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={signingUp ? "new-password" : "current-password"}
          required
          minLength={8}
          maxLength={128}
        />
        <button type="submit">{pending ? "Please wait…" : signingUp ? "Create account" : "Sign in"}</button>
      </fieldset>
      {state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}
