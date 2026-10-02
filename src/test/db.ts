import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

/** A Drizzle client for the test database. Close it with `pool.end()`. */
export function createTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 2 });
  return { pool, db: drizzle(pool, { schema }) };
}
