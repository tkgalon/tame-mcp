import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./generated.js";

export type Database = Kysely<DB>;

export function createDatabase(connectionString: string, maxConnections = 5): Database {
  const pool = new pg.Pool({ connectionString, max: maxConnections, connectionTimeoutMillis: 5_000 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
