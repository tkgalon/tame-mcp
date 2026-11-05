"use client";

import { Fragment, useState } from "react";
import type { DocumentStatus, DocumentStyle } from "@tame/contracts";
import { deleteDocument, retryExtraction } from "../app/(app)/collections/actions";
import { fileType, formatSize } from "../lib/files";
import { ConfirmPanel } from "./confirm";
import { Sig } from "./sig";
import type { Tone } from "./sig";
import { StyleSummary } from "./style-summary";

export type DocumentRow = {
  id: string;
  name: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorCode: string | null;
  outdated: boolean;
  style: DocumentStyle | null;
};

const STATUS: Record<DocumentStatus, { tone: Tone; label: string; note: string }> = {
  uploading: {
    tone: "warn",
    label: "Unfinished",
    note: "The upload did not finish. Delete it and upload the file again.",
  },
  ready: { tone: "ok", label: "Ready", note: "Ready for your agent." },
  needs_ocr: {
    tone: "off",
    label: "No text",
    note: "No text found. Scanned documents are not supported yet.",
  },
  unsupported: { tone: "off", label: "Unsupported", note: "This format could not be read." },
  failed: { tone: "bad", label: "Failed", note: "Reading failed." },
};

function describe(document: DocumentRow) {
  if (document.status === "ready" && document.outdated) {
    return {
      tone: "warn" as Tone,
      label: "Read again",
      note: "Read by an older version without the style summary.",
    };
  }
  const status = STATUS[document.status];
  return { ...status, note: status.note + (document.errorCode ? ` Code: ${document.errorCode}.` : "") };
}

export function DocumentTable({
  collectionId,
  documents,
}: {
  collectionId: string;
  documents: DocumentRow[];
}) {
  const [open, setOpen] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" className="hide-sm">
              Size
            </th>
            <th scope="col">Status</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const type = fileType(document.name);
            const status = describe(document);
            const canRetry = document.status === "failed" || document.outdated;
            const showStyle = document.style !== null && open === document.id;
            return (
              <Fragment key={document.id}>
                <tr>
                  <td>
                    <span className="fname">
                      <span className={type.className}>{type.label}</span>
                      {document.name}
                    </span>
                  </td>
                  <td className="hide-sm small">{formatSize(document.sizeBytes)}</td>
                  <td>
                    <Sig tone={status.tone}>{status.label}</Sig>
                    <div className="doc-status">{status.note}</div>
                  </td>
                  <td>
                    <div className="actions">
                      {canRetry && (
                        <form action={retryExtraction}>
                          <input type="hidden" name="id" value={document.id} />
                          <button className="btn sm" type="submit">
                            {document.outdated ? "Read again" : "Retry"}
                          </button>
                        </form>
                      )}
                      {document.style && (
                        <button
                          className="btn sm"
                          type="button"
                          aria-expanded={showStyle}
                          onClick={() => setOpen(showStyle ? "" : document.id)}
                        >
                          {showStyle ? "Hide style" : "Style"}
                        </button>
                      )}
                      <button
                        className="btn sm danger"
                        type="button"
                        onClick={() => setConfirm(confirm === document.id ? "" : document.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {confirm === document.id && (
                  <tr>
                    <td colSpan={4}>
                      <ConfirmPanel
                        action={deleteDocument}
                        fields={{ id: document.id, collectionId }}
                        message={`Delete ${document.name}. Profiles keep the quotes they already use.`}
                        confirmLabel="Delete file"
                        onCancel={() => setConfirm("")}
                      />
                    </td>
                  </tr>
                )}
                {showStyle && document.style && (
                  <tr>
                    <td colSpan={4} style={{ paddingTop: 0 }}>
                      <div
                        className="fade"
                        style={{ borderRadius: 14, background: "var(--s2)", paddingTop: 12 }}
                      >
                        <StyleSummary style={document.style} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
