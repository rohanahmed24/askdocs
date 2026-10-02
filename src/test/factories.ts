import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { EMBEDDING_DIMENSIONS, documentFiles, documents, memberships, organizations, user } from "@/db/schema";

/** A user, an organization and an owner membership. */
export async function seedOrg(db: Db, n = 1) {
  const userId = `user-${n}`;
  await db.insert(user).values({ id: userId, name: `User ${n}`, email: `user${n}@example.com` });
  const [org] = await db.insert(organizations).values({ name: `Org ${n}`, slug: `org-${n}` }).returning();
  await db.insert(memberships).values({ orgId: org.id, userId, role: "owner" });
  return { userId, org };
}

export async function seedDocument(
  db: Db,
  input: { orgId: string; userId: string; filename?: string; data?: Uint8Array; status?: "queued" | "processing" | "ready" | "failed"; updatedAt?: Date },
) {
  const data = input.data ?? new TextEncoder().encode("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  const [doc] = await db
    .insert(documents)
    .values({
      orgId: input.orgId,
      uploadedBy: input.userId,
      filename: input.filename ?? "notes.txt",
      contentType: "text/plain",
      sizeBytes: data.byteLength,
      status: input.status ?? "queued",
    })
    .returning();
  await db.insert(documentFiles).values({ documentId: doc.id, orgId: input.orgId, data: Buffer.from(data) });
  if (input.updatedAt) {
    // updated_at is set by the database default and $onUpdate, so set it last.
    await db.update(documents).set({ updatedAt: input.updatedAt }).where(eq(documents.id, doc.id));
  }
  return doc;
}

/** A deterministic fake embedding: the same text always gives the same vector. */
export function fakeVector(text: string): number[] {
  const bytes = createHash("sha256").update(text).digest();
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => bytes[i % bytes.length] / 255);
}

export const fakeEmbed = async (texts: string[]) => texts.map(fakeVector);

/** Test-only chunker: one chunk per paragraph. The real chunker is hand-written. */
export const paragraphChunker = (text: string) => text.split(/\n\s*\n/);
