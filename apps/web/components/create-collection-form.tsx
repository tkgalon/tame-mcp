"use client";

import { useActionState } from "react";
import { createCollectionAction } from "../app/collections/actions";
import { initialCollectionState } from "../lib/collections/schema";

export function CreateCollectionForm() {
  const [state, action, pending] = useActionState(createCollectionAction, initialCollectionState);
  return (
    <form action={action}>
      <fieldset disabled={pending}>
        <legend>New collection</legend>
        <label htmlFor="collection-name">Name</label>
        <input id="collection-name" name="name" type="text" required maxLength={120} />
        <button type="submit">{pending ? "Creating…" : "Create collection"}</button>
      </fieldset>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  );
}
