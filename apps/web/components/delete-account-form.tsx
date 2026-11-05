"use client";

import { useActionState, useState } from "react";
import { deleteAccount } from "../app/(app)/account/actions";
import { idle } from "../lib/action-state";

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccount, idle);
  const [typed, setTyped] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const value = typed.trim().toLowerCase();
  const match = value === email.toLowerCase();
  const mismatch = value.indexOf("@") > 0 && !match && value.length >= email.length;
  return (
    <form action={action} className="card-b" style={{ display: "grid", gap: 16 }}>
      <p className="alert info">
        Export the profiles you want to keep first.{" "}
        <a href="/profiles" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
          Go to Profiles
        </a>
      </p>
      <div className="field">
        <label htmlFor="email">Type your account email</label>
        <input
          id="email"
          className="input"
          name="email"
          type="email"
          autoComplete="off"
          required
          maxLength={254}
          placeholder={email}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Permanently delete my account, files, profiles and connections. This cannot be undone.</span>
      </label>
      {(mismatch || state.message) && (
        <p className="alert" role="alert">
          {mismatch ? "The email does not match this account." : state.message}
        </p>
      )}
      <div>
        <button className="btn danger p" type="submit" disabled={!(match && confirmed) || pending}>
          {pending ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </form>
  );
}
