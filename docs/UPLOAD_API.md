# Document upload API

This contract is for the frontend and integration clients. It uses the existing web session cookie. It does not require a service-role key. All responses use `Cache-Control: private, no-store`.

POST requests must include an `Origin` header exactly matching `TAME_SITE_URL`. Browser requests from the configured site send it automatically. Send the existing session cookie with API requests. There is no bearer-token API for agents in this milestone.

## Flow

1. Register metadata once and retain the returned document ID.
2. Request a signed upload URL for that ID.
3. Send bytes directly to Supabase Storage.
4. Confirm the upload through the API.
5. Read the document list to obtain its status.

Apply the local migrations with `npx pnpm@10.34.9 db:migrate` before testing. This applies pending local migrations without resetting existing data.

## Register

`POST /api/collections/{collectionId}/uploads`

Content-Type: `application/json`. Metadata body limit: 8 KiB.

```json
{ "name": "writeup.md", "sizeBytes": 1200 }
```

Returns `201`:

```json
{
  "document": {
    "id": "document-uuid",
    "collection_id": "collection-uuid",
    "name": "writeup.md",
    "media_type": "text/markdown",
    "size_bytes": 1200,
    "status": "uploading",
    "created_at": "2026-11-01T08:00:00Z"
  }
}
```

Supported extensions are PDF, DOCX, TXT, MD, and MARKDOWN. Maximum size is 10 MiB, or 10,485,760 bytes. Owner, storage path, initial status, and canonical MIME type are assigned by the backend. Untrusted owner/path fields in the request are not used.

Registration creates a new record each time. Retain its ID rather than repeating registration when retrying an interrupted transfer.

## Get or retry a signed URL

`POST /api/documents/{documentId}/upload-url`

No request body. Returns `200`:

```json
{
  "upload": {
    "path": "owner-uuid/document-uuid/original",
    "token": "temporary-upload-token",
    "signedUrl": "https://project.supabase.co/storage/v1/object/upload/sign/documents/owner-uuid/document-uuid/original?token=temporary-upload-token",
    "contentType": "text/markdown",
    "method": "PUT"
  }
}
```

Use the returned content type when uploading. With a Supabase client configured using the public project key:

```ts
await supabase.storage.from("documents").uploadToSignedUrl(
  upload.path,
  upload.token,
  file,
  { contentType: upload.contentType },
);
```

The browser client does not need to read the HttpOnly web session cookie to use this signed token. Alternatively, PUT the raw bytes to the returned signed URL with the returned `Content-Type`. Verify the Storage response before confirming.

Signed URLs are temporary credentials. Do not persist them in analytics, error logs, or profile data. Obtain a new URL if it expires. Replacement is disabled. If a transfer may already have succeeded, try confirmation before sending the same bytes again.

## Confirm

`POST /api/documents/{documentId}/complete`

No request body. Returns `200` with the document summary. The backend checks the stored object's size and MIME metadata before changing `uploading` to `uploaded`. Repeating confirmation is safe and does not reset later processing states.

`uploaded` means stored, not analyzed or ready for profile inference. File signature validation, parsing, content hashing, and processing jobs are handled in the worker milestone. Size and MIME metadata checks do not prove the bytes are a valid PDF or DOCX.

## List

`GET /api/collections/{collectionId}/documents?page=1`

Returns `200` with `{ "items": [documentSummary], "page": 1, "hasNextPage": false }`. Pages contain at most 20 documents, ordered by creation time descending with ID as a tie-breaker. Page must be between 1 and 10000. Missing and inaccessible collections both return `404`.

## Errors

Errors use `{ "error": { "code": "machine_code", "message": "safe message" } }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid ID, page, JSON, or upload metadata |
| 401 | No valid web session |
| 403 | Wrong/missing origin or operation not allowed for the session |
| 404 | Inaccessible or missing collection, document, or stored object |
| 409 | Upload already closed or stored metadata does not match registration |
| 413 | Metadata request exceeds 8 KiB |
| 415 | Registration request is not JSON |
| 500 / 502 / 503 | Application, provider, or configuration failure |

Signing can be retried for the same pending document. Failed or abandoned transfers remain `uploading`. Cleanup of abandoned registrations and orphaned objects is deferred to the worker/reconciliation milestone. No parser or MCP endpoint is introduced by this API.

## Run the local integration test

With Docker and local Supabase running, apply migrations, stop any running Next.js development server, then run:

```bash
npx pnpm@10.34.9 db:migrate
npx pnpm@10.34.9 build:packages
npx pnpm@10.34.9 --filter @tame/web build
npx pnpm@10.34.9 test:upload
```

The test starts a separate production web process on an available loopback port. It obtains local credentials in memory, creates two confirmed temporary users without sending email, exercises real Auth/Data/Storage APIs, and cleans up its users, collections, and files. It does not modify existing user collections or print keys and signed URLs. It refuses hosted Supabase URLs.

The test covers SDK and raw PUT transfers, missing objects, metadata mismatch, confirmation retry, cross-origin requests, and cross-account isolation. Passing this test verifies upload storage, not document parsing or inference.
