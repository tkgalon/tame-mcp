"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_ACCEPT } from "@tame/contracts";
import { finishUpload, startUpload } from "../app/(app)/collections/actions";
import { fileType, formatSize } from "../lib/files";
import { Sig } from "./sig";

type Result = { name: string; ok: boolean; message: string };

export function UploadForm({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  async function upload(file: File): Promise<Result> {
    const ticket = await startUpload(collectionId, file.name, file.size);
    if (!ticket.ok) return { name: file.name, ok: false, message: ticket.message };
    // The file goes straight to Storage, the server only issues the signed URL
    const transfer = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": ticket.contentType },
      body: file,
    }).catch(() => null);
    if (!transfer?.ok)
      return { name: file.name, ok: false, message: "The transfer failed. Use Retry below." };
    const state = await finishUpload(ticket.documentId);
    return state.status === "success"
      ? { name: file.name, ok: true, message: "Ready for your agent." }
      : { name: file.name, ok: false, message: state.message };
  }

  async function submit() {
    if (files.length === 0 || pending) return;
    setPending(true);
    setResults([]);
    const done: Result[] = [];
    for (const file of files) done.push(await upload(file));
    setResults(done);
    setFiles([]);
    setPending(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  function clear() {
    setFiles([]);
    setResults([]);
    if (input.current) input.current.value = "";
  }

  const selected = !pending && files.length > 0;
  return (
    <div className="card-b">
      <div
        className={selected || dragging ? "drop on" : "drop"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!pending) {
            setResults([]);
            setFiles([...event.dataTransfer.files]);
          }
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
        </svg>
        <input
          ref={input}
          id="documents"
          className="file-input"
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          aria-label="Files"
          onChange={(event) => {
            setResults([]);
            setFiles([...(event.target.files ?? [])]);
          }}
        />
        {pending ? (
          <>
            <p style={{ fontWeight: 500 }}>Uploading…</p>
            <div className="bar" aria-hidden="true">
              <i />
            </div>
          </>
        ) : selected ? (
          <>
            <p style={{ fontWeight: 500 }}>
              Selected {files.length} {files.length === 1 ? "file" : "files"}
            </p>
            <ul className="uplist fade">
              {files.map((file, index) => {
                const type = fileType(file.name);
                return (
                  <li key={index}>
                    <span className="fname">
                      <span className={type.className}>{type.label}</span>
                      {file.name}
                    </span>
                    <span className="small">{formatSize(file.size)}</span>
                  </li>
                );
              })}
            </ul>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" type="button" onClick={clear}>
                Clear
              </button>
              <button className="btn p" type="button" onClick={submit}>
                Upload
              </button>
            </div>
          </>
        ) : results.length > 0 ? (
          <>
            <ul className="uplist fade" role="status">
              {results.map((result, index) => (
                <li key={index}>
                  <span>{result.name}</span>
                  <Sig tone={result.ok ? "ok" : "bad"}>{result.message}</Sig>
                </li>
              ))}
            </ul>
            <button className="btn ghost sm" type="button" onClick={clear}>
              Upload more
            </button>
          </>
        ) : (
          <>
            <p style={{ fontWeight: 500 }}>Drop files here, or choose them.</p>
            <button className="btn" type="button" onClick={() => input.current?.click()}>
              Choose files
            </button>
          </>
        )}
      </div>
      <p className="small" style={{ marginTop: 12 }}>
        Scanned PDFs without text cannot be read yet.
      </p>
    </div>
  );
}
