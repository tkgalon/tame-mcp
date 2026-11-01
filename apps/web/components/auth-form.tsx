"use client";

import { useActionState } from "react";
import { signInAction, signUpAction } from "../app/auth/actions";
import { initialAuthState } from "../lib/auth/form";

export function AuthForm({ mode, authorizationId }: { mode: "sign-in" | "sign-up"; authorizationId?: string | undefined }) {
  const signingUp = mode === "sign-up";
  const [state, action, pending] = useActionState(signingUp ? signUpAction : signInAction, initialAuthState);
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
          minLength={signingUp ? 8 : 1}
          maxLength={128}
          aria-describedby={signingUp ? "password-help" : undefined}
        />
        {signingUp && <small id="password-help">Use 8 to 128 characters.</small>}
        <button type="submit">{pending ? "Please wait…" : signingUp ? "Create account" : "Sign in"}</button>
      </fieldset>
      {state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}
