"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_ACCEPT } from "@tame/contracts";
import { finishUpload, startUpload } from "../app/(app)/collections/actions";

export function UploadForm({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function upload(file: File): Promise<string> {
    const ticket = await startUpload(collectionId, file.name, file.size);
    if (!ticket.ok) return `${file.name}: ${ticket.message}`;
    // The file goes straight to Storage, the server only issues the signed URL
    const transfer = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": ticket.contentType },
      body: file,
    }).catch(() => null);
    if (!transfer?.ok) return `${file.name}: the transfer failed. Use Retry on the document below.`;
    return (await finishUpload(ticket.documentId)).message;
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (files.length === 0 || pending) return;
        const form = event.currentTarget;
        setPending(true);
        setMessages([]);
        for (const file of files) {
          const message = await upload(file);
          setMessages((current) => [...current, message]);
        }
        form.reset();
        setFiles([]);
        setPending(false);
        router.refresh();
      }}
    >
      <fieldset disabled={pending}>
        <legend>Upload examples</legend>
        <div
          className={dragging ? "dropzone dragging" : "dropzone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!pending) setFiles([...event.dataTransfer.files]);
          }}
        >
          <p>Drop files here, or choose them.</p>
          <label htmlFor="documents">Files</label>
          <input
            id="documents"
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            onChange={(event) => setFiles([...(event.target.files ?? [])])}
          />
        </div>
        {files.length > 0 && (
          <p>
            Selected {files.length} {files.length === 1 ? "file" : "files"}:{" "}
            {files.map((file) => file.name).join(", ")}
          </p>
        )}
        <p>PDF, DOCX, TXT or Markdown, up to 10 MiB each. Scanned PDFs without text cannot be read yet.</p>
        <button type="submit" disabled={files.length === 0}>
          {pending ? "Uploading…" : "Upload"}
        </button>
      </fieldset>
      {messages.length > 0 && (
        <ul role="status">
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
