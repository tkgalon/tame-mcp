"use client";

import { useState } from "react";

type Props = {
  action: (form: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  warning: string;
};

// Destructive actions need an explicit tick before the button unlocks
export function ConfirmForm({ action, fields, label, warning }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{" "}
        {warning}
      </label>
      <button type="submit" disabled={!confirmed}>
        {label}
      </button>
    </form>
  );
}
