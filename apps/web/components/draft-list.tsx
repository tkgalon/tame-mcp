"use client";

import { Fragment, useState } from "react";
import { deleteDraft } from "../app/(app)/profiles/actions";
import { ConfirmPanel } from "./confirm";

export function DraftList({ drafts }: { drafts: { id: string; name: string }[] }) {
  const [confirm, setConfirm] = useState("");
  return drafts.map((draft) => (
    <Fragment key={draft.id}>
      <div className="draft">
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{draft.name}</span>
          <span className="small">
            draft <span className="code">{draft.id.slice(0, 8)}</span>
          </span>
        </div>
        {confirm !== draft.id && (
          <button className="btn sm danger" type="button" onClick={() => setConfirm(draft.id)}>
            Delete draft
          </button>
        )}
      </div>
      {confirm === draft.id && (
        <div style={{ padding: "0 22px 18px" }}>
          <ConfirmPanel
            action={deleteDraft}
            fields={{ id: draft.id }}
            message="Delete this unpublished draft."
            confirmLabel="Delete draft"
            onCancel={() => setConfirm("")}
          />
        </div>
      )}
    </Fragment>
  ));
}
