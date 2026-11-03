"use client";

import { useActionState, useState } from "react";
import { deleteAccount } from "../app/(app)/account/actions";
import { idle } from "../lib/action-state";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, idle);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action={action}>
      <fieldset disabled={pending}>
        <legend>Delete account</legend>
        <label htmlFor="email">Type your account email</label>
        <input id="email" name="email" type="email" autoComplete="off" required maxLength={254} />
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          Permanently delete my account, files, profiles and connections. This cannot be undone.
        </label>
        <button type="submit" disabled={!confirmed}>
          {pending ? "Deleting…" : "Delete account"}
        </button>
      </fieldset>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  );
}
