// Creates the end-to-end database if it is missing, applies the migrations and empties it.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const adminUrl = process.env.E2E_ADMIN_URL;
const e2eUrl = process.env.E2E_DATABASE_URL;
if (!adminUrl || !e2eUrl) throw new Error("E2E_ADMIN_URL and E2E_DATABASE_URL must be set");
const name = new URL(e2eUrl).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name: ${name}`);

const admin = new Pool({ connectionString: adminUrl, max: 1 });
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const pool = new Pool({ connectionString: e2eUrl, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
await pool.query('TRUNCATE TABLE organizations, "user" CASCADE');
await pool.end();
console.log(`end-to-end database ${name} is ready`);
