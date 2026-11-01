export function job(overrides = {}) {
  const owner = "11111111-1111-4111-8111-111111111111";
  const document = "22222222-2222-4222-8222-222222222222";
  return {
    id: "33333333-3333-4333-8333-333333333333", owner_id: owner, document_id: document,
    lease_token: "44444444-4444-4444-8444-444444444444", lease_until: new Date(Date.now() + 120_000).toISOString(),
    status: "running", attempts: 1, extraction_version: 1, size_bytes: 5, media_type: "text/plain",
    storage_path: `${owner}/${document}/original`, content_hash: null, parser_version: null,
    ...overrides,
  };
}
export const signal = () => new AbortController().signal;
