"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type Action = (form: FormData) => Promise<void>;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn sm danger p" type="submit" disabled={pending}>
      {label}
    </button>
  );
}

type PanelProps = {
  action: Action;
  fields: Record<string, string>;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
};

// Destructive actions ask once more inline, next to what they delete
export function ConfirmPanel({ action, fields, message, confirmLabel, onCancel }: PanelProps) {
  return (
    <div className="confirm">
      <p>{message}</p>
      <form action={action} style={{ display: "flex", gap: 8 }}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button className="btn sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <Submit label={confirmLabel} />
      </form>
    </div>
  );
}

type FormProps = Omit<PanelProps, "onCancel" | "confirmLabel"> & { label: string };

export function ConfirmForm({ label, ...panel }: FormProps) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ConfirmPanel {...panel} confirmLabel={label} onCancel={() => setOpen(false)} />
  ) : (
    <div>
      <button className="btn danger" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    </div>
  );
}
