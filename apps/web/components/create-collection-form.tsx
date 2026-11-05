"use client";

import { useActionState, useState } from "react";
import { createCollection } from "../app/(app)/collections/actions";
import { idle } from "../lib/action-state";

export function CreateCollectionForm() {
  const [state, action, pending] = useActionState(createCollection, idle);
  const [name, setName] = useState("");
  return (
    <form action={action} className="card-b" style={{ display: "grid", gap: 12 }}>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="collection-name">Name</label>
          <input
            id="collection-name"
            className="input"
            name="name"
            type="text"
            required
            maxLength={120}
            placeholder="Meeting notes"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button className="btn p lg" type="submit" disabled={pending || name.trim().length === 0}>
          {pending ? "Creating…" : "Create collection"}
        </button>
      </div>
      {state.message && (
        <p className="alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
