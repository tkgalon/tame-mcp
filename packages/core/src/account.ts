import { sql } from "kysely";
import type { CoreContext } from "./context.js";
import { TameError } from "./errors.js";

// Revoking an app in Supabase deletes its sessions, so an unexpired token stops working here at once
export async function isSessionActive(
  { db }: CoreContext,
  identity: { ownerId: string; clientId: string; sessionId: string },
): Promise<boolean> {
  const result = await sql<{ active: boolean }>`
    select exists (
      select 1 from auth.sessions
      where id = ${identity.sessionId}::uuid
        and user_id = ${identity.ownerId}::uuid
        and oauth_client_id = ${identity.clientId}::uuid
        and (not_after is null or not_after > now())
    ) as active`.execute(db);
  return result.rows[0]?.active === true;
}

// Signing in is open to any Google account, using TAME needs the owner to approve the account's email
export async function hasAccess({ db }: CoreContext, ownerId: string): Promise<boolean> {
  const result = await sql<{ approved: boolean }>`
    select exists (
      select 1 from auth.users u
      join public.allowed_emails a on a.email = lower(u.email)
      where u.id = ${ownerId}::uuid
    ) as approved`.execute(db);
  return result.rows[0]?.approved === true;
}

export async function requireAccess(context: CoreContext, ownerId: string): Promise<void> {
  if (!(await hasAccess(context, ownerId))) {
    throw new TameError(
      "not_approved",
      "This TAME account is not approved yet. Ask the TAME owner to approve the account email.",
    );
  }
}

// Deleting the auth user cascades every table, so only the stored files need explicit cleanup first
export async function removeAccountFiles({ db, files }: CoreContext, ownerId: string) {
  const documents = await db
    .selectFrom("documents")
    .where("owner_id", "=", ownerId)
    .select("storage_path")
    .execute();
  await files.remove(documents.map((document) => document.storage_path));
}
