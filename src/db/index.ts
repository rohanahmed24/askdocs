import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development. On a serverless host every instance has its own pool,
// so set DB_POOL_MAX to a small number (3) there and use the pooled connection string.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool = globalForDb.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
