"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_ACCEPT } from "../lib/documents/upload-schema";
import { uploadDocument, UploadError } from "../lib/documents/upload";
import type { UploadCheckpoint } from "../lib/documents/upload";

export function UploadDocumentForm({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const checkpoint = useRef<UploadCheckpoint | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  return (
    <form onSubmit={async event => {
      event.preventDefault();
      if (!file || pending) return;
      const form = event.currentTarget;
      setPending(true); setError(""); setMessage("");
      const attempt = new AbortController();
      controller.current = attempt;
      try {
        await uploadDocument({ collectionId, file, checkpoint: checkpoint.current,
          onCheckpoint: value => { checkpoint.current = value; }, onStage: setMessage, signal: attempt.signal });
        if (attempt.signal.aborted) return;
        checkpoint.current = null; setFile(null); form.reset();
        setMessage(`Uploaded ${file.name}. Refresh status to check extraction.`);
        router.refresh();
      } catch (failure) {
        if (!attempt.signal.aborted) {
          setMessage("");
          setError(failure instanceof UploadError ? failure.message : "Unable to upload. Retry with the same file.");
          router.refresh();
        }
      } finally { if (!attempt.signal.aborted) setPending(false); }
    }}>
      <fieldset disabled={pending}>
        <legend>Upload document</legend>
        <label htmlFor="document-file">File</label>
        <input id="document-file" name="document" type="file" accept={DOCUMENT_ACCEPT} required
          onChange={event => { setFile(event.target.files?.[0] ?? null); checkpoint.current = null; setError(""); setMessage(""); }} />
        <p>PDF, DOCX, TXT, or Markdown. Maximum 10 MiB. Scanned PDFs require OCR and cannot be extracted yet.</p>
        <button type="submit" disabled={!file}>{pending ? "Uploading…" : checkpoint.current ? "Retry upload" : "Upload"}</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function RefreshDocumentsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    {pending ? "Refreshing…" : "Refresh status"}
  </button>;
}
