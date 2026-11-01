import { z } from "zod";
export const authorizationIdSchema = z.string().regex(/^[A-Za-z0-9]{32}$/);
export function authorizationId(value: unknown): string | null {
  const result = authorizationIdSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function consentPath(value: unknown): string {
  const id = authorizationId(value);
  return id ? `/oauth/consent?authorization_id=${id}` : "/";
}
const callbackUrl = z.url().refine(value => {
  const url = URL.parse(value);
  return Boolean(url && !url.username && !url.password && !url.hash
    && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))));
});
export const consentContextSchema = z.object({
  authorization_id: authorizationIdSchema, client_id: z.uuid(), client_name: z.string().max(1000).nullable(),
  resource_url: z.url(), redirect_uri: callbackUrl, scope: z.string().max(1000), state: z.string().max(4096).nullable(),
  status: z.enum(["pending", "approved"]), user_id: z.uuid().nullable(), authorization_code: z.string().min(1).max(4096).nullable(),
});
export type ConsentContext = z.infer<typeof consentContextSchema>;
export function callbackFor(context: ConsentContext, approved: boolean): string {
  const url = new URL(context.redirect_uri);
  for (const name of ["code", "state", "error", "error_description"]) url.searchParams.delete(name);
  if (approved) {
    if (!context.authorization_code || context.status !== "approved") throw new Error("Provider approval missing.");
    url.searchParams.set("code", context.authorization_code);
  } else url.searchParams.set("error", "access_denied");
  if (context.state !== null) url.searchParams.set("state", context.state);
  return url.href;
}
