import { sql } from "kysely";
import type { CoreContext } from "./context.js";

// A trivial query, so a health check proves the database answers and counts as activity on it
export async function pingDatabase({ db }: CoreContext): Promise<void> {
  await sql`select 1`.execute(db);
}
