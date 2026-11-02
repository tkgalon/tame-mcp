import { sql } from "kysely";
import type { CoreContext } from "./context.js";

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

// Deleting the auth user cascades every table, so only the stored files need explicit cleanup first
export async function removeAccountFiles({ db, files }: CoreContext, ownerId: string) {
  const documents = await db
    .selectFrom("documents")
    .where("owner_id", "=", ownerId)
    .select("storage_path")
    .execute();
  await files.remove(documents.map((document) => document.storage_path));
}
