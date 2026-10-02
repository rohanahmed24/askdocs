// Smoke test with the REAL embedding model: ingests a small English and Bengali
// document into the test database, asks three questions and prints the top
// matches. Uses 2 of the 50 daily requests that free models allow. It empties
// the test database first and last.
//
//   pnpm smoke:embeddings
import { sql } from "drizzle-orm";
import { chunkText } from "@/chunker";
import { createOpenRouterEmbedder } from "@/server/embeddings";
import { createDocument } from "@/server/documents";
import { ingestDocument } from "@/server/ingest";
import { reserveStorage } from "@/server/quota";
import { createTestDb } from "@/test/db";
import { seedOrg } from "@/test/factories";

process.loadEnvFile(".env");
const { db, pool } = createTestDb();
const embed = createOpenRouterEmbedder({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_EMBEDDING_MODEL });

const text = [
  "Payment terms. The customer must pay every invoice within thirty days of receiving it. A late fee of two percent applies after that.",
  "Server outage policy. If the production server is down for more than one hour, the support team must notify all customers by email.",
  "Office pets. The Dhaka office allows one cat on the second floor, but dogs are not permitted in the building.",
  "চালান ও পরিশোধ। গ্রাহককে চালান পাওয়ার ত্রিশ দিনের মধ্যে টাকা পরিশোধ করতে হবে।",
].join("\n\n");

await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
const { userId, org } = await seedOrg(db);
const created = await createDocument(db, { reserveStorage, enqueue: async () => {} }, { orgId: org.id, userId, filename: "policy.txt", data: new TextEncoder().encode(text) });
if (!created.ok) throw new Error(created.message);
await ingestDocument(db, { embed, chunk: (t) => chunkText(t, { size: 160, overlap: 20 }) }, { documentId: created.document.id, isLastAttempt: true });
const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM chunks`)).rows as { n: number }[];
console.log(`ingested ${n} chunks, column type: ${((await db.execute(sql`SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid='chunks'::regclass AND attname='embedding'`)).rows[0] as { t: string }).t}`);

const questions = ["When must the customer pay the invoice?", "চালান কবে পরিশোধ করতে হবে?", "Who is told when the server is down?"];
const vectors = await embed(questions);
for (const [i, q] of questions.entries()) {
  const literal = `[${vectors[i].join(",")}]`;
  const rows = (await db.execute(sql`
    SELECT content, 1 - (embedding <=> ${literal}::halfvec) AS sim
    FROM chunks WHERE org_id = ${org.id}
    ORDER BY embedding <=> ${literal}::halfvec LIMIT 2`)).rows as { content: string; sim: number }[];
  console.log(`\nQ: ${q}`);
  for (const r of rows) console.log(`  ${Number(r.sim).toFixed(3)}  ${r.content.replace(/\s+/g, " ").slice(0, 70)}`);
}
await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
await pool.end();
