import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { chunks, documents, memberships, messages, queryEmbeddings, type Citation } from "@/db/schema";
import { releaseStorage } from "./quota";

/**
 * Thrown when a user asks for an organization they do not belong to
 * (`not_member`) or for an owner-only action without being an owner (`not_owner`).
 * Routes turn it into a 403.
 */
export class OrgAccessError extends Error {
  constructor(
    readonly reason: "not_member" | "not_owner",
    readonly orgId: string,
  ) {
    super(reason === "not_member" ? "You are not a member of this organization." : "Only an owner can do this.");
    this.name = "OrgAccessError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrgRole = typeof memberships.$inferSelect.role;

/** A passage found by `searchChunks`. `similarity` is 1 minus the cosine distance. */
export type PassageHit = {
  chunkId: string;
  documentId: string;
  filename: string;
  ordinal: number;
  content: string;
  similarity: number;
};

export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; createdAt: Date };

/**
 * Proof that `userId` belongs to `orgId`, plus queries that are already limited
 * to that organization. Routes and pages read tenant data through this object
 * instead of writing their own `where org_id = ...`, so the filter cannot be forgotten.
 */
export type OrgScope = ReturnType<typeof createScope>;

/**
 * Checks that the user is a member of the organization and returns its scope.
 * Throws `OrgAccessError("not_member")` otherwise. Always check membership in
 * the database: never trust an organization id that came from the request.
 */
export async function getOrgScope(db: Db, userId: string, orgId: string) {
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  if (!membership) throw new OrgAccessError("not_member", orgId);
  return createScope(db, { userId, orgId, role: membership.role });
}

function createScope(db: Db, ctx: { userId: string; orgId: string; role: OrgRole }) {
  const { userId, orgId, role } = ctx;

  /**
   * `org_id = this organization`, plus any extra conditions. Use it for every
   * query on a table that has an `orgId` column and has no helper below.
   */
  function inOrg(table: { orgId: PgColumn }, ...conditions: (SQL | undefined)[]): SQL {
    return and(eq(table.orgId, orgId), ...conditions) as SQL;
  }

  /** One document of this organization, or null. */
  async function getDocument(documentId: string) {
    // A malformed id (for example from a URL) is simply "not found", not a database error.
    if (!UUID.test(documentId)) return null;
    const [doc] = await db
      .select()
      .from(documents)
      .where(inOrg(documents, eq(documents.id, documentId)))
      .limit(1);
    return doc ?? null;
  }

  return {
    userId,
    orgId,
    role,
    isOwner: role === "owner",
    inOrg,

    /** Throws `OrgAccessError("not_owner")` unless the user is an owner. */
    requireOwner() {
      if (role !== "owner") throw new OrgAccessError("not_owner", orgId);
    },

    /** The organization's documents, newest first. Never reads file contents. */
    listDocuments() {
      return db.select().from(documents).where(inOrg(documents)).orderBy(desc(documents.createdAt));
    },

    /**
     * Deletes a document of this organization with its file and chunks, and gives its
     * bytes back to the quota. Owners can delete any document; members only the ones
     * they uploaded (`OrgAccessError("not_owner")` otherwise). Returns false when the
     * document does not exist in this organization.
     */
    async deleteDocument(documentId: string): Promise<boolean> {
      if (!UUID.test(documentId)) return false;
      return db.transaction(async (tx) => {
        const [doc] = await tx
          .select({ uploadedBy: documents.uploadedBy, sizeBytes: documents.sizeBytes })
          .from(documents)
          .where(inOrg(documents, eq(documents.id, documentId)))
          .for("update")
          .limit(1);
        if (!doc) return false;
        if (role !== "owner" && doc.uploadedBy !== userId) throw new OrgAccessError("not_owner", orgId);
        await tx.delete(documents).where(inOrg(documents, eq(documents.id, documentId)));
        await releaseStorage(tx, orgId, doc.sizeBytes);
        return true;
      });
    },

    /** One document of this organization, or null. An id from another organization gives null. */
    getDocument,

    /**
     * The passages of this organization's `ready` documents closest to a question
     * vector, best first. Only this organization's chunks can come back: the
     * filter is part of the query, not applied afterwards.
     *
     * The index finds nearest neighbours across all organizations first, so a
     * small organization could get too few rows back. `iterative_scan` makes
     * pgvector keep scanning until the limit is met under the filter.
     */
    async searchChunks(queryVector: number[], options: { limit?: number; minSimilarity?: number } = {}): Promise<PassageHit[]> {
      const limit = options.limit ?? 6;
      const minSimilarity = options.minSimilarity ?? 0;
      const literal = `[${queryVector.join(",")}]`;
      const distance = sql<number>`${chunks.embedding} <=> ${literal}::halfvec`;

      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
        await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`);
        const rows = await tx
          .select({
            chunkId: chunks.id,
            documentId: chunks.documentId,
            filename: documents.filename,
            ordinal: chunks.ordinal,
            content: chunks.content,
            distance,
          })
          .from(chunks)
          .innerJoin(documents, eq(documents.id, chunks.documentId))
          .where(and(inOrg(chunks), inOrg(documents, eq(documents.status, "ready"))))
          .orderBy(distance)
          .limit(limit);
        return rows
          .map(({ distance: d, ...row }) => ({ ...row, similarity: 1 - Number(d) }))
          .filter((row) => row.similarity >= minSimilarity);
      });
    },

    /** Saves one chat message of the signed-in user's conversation. */
    async addMessage(message: { role: "user" | "assistant"; content: string; citations?: Citation[] }) {
      await db.insert(messages).values({ orgId, userId, role: message.role, content: message.content, citations: message.citations ?? [] });
    },

    /** The user's latest messages in this organization, oldest first. */
    async listMessages(limit = 40): Promise<StoredMessage[]> {
      const rows = await db
        .select({ id: messages.id, role: messages.role, content: messages.content, citations: messages.citations, createdAt: messages.createdAt })
        .from(messages)
        .where(inOrg(messages, eq(messages.userId, userId)))
        .orderBy(desc(messages.createdAt))
        .limit(limit);
      return rows.reverse();
    },

    /** When the user asked their questions since `since`, oldest first. Used for the hourly question limit. */
    async questionTimesSince(since: Date): Promise<Date[]> {
      const rows = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(inOrg(messages, eq(messages.userId, userId), eq(messages.role, "user"), gte(messages.createdAt, since)))
        .orderBy(asc(messages.createdAt));
      return rows.map((r) => r.createdAt);
    },

    /** The saved embedding of a question text (identified by its hash), or null. */
    async getCachedEmbedding(model: string, textHash: string): Promise<number[] | null> {
      const [row] = await db
        .select({ embedding: queryEmbeddings.embedding })
        .from(queryEmbeddings)
        .where(inOrg(queryEmbeddings, eq(queryEmbeddings.model, model), eq(queryEmbeddings.textHash, textHash)))
        .limit(1);
      return row?.embedding ?? null;
    },

    async cacheEmbedding(model: string, textHash: string, embedding: number[]) {
      await db.insert(queryEmbeddings).values({ orgId, model, textHash, embedding }).onConflictDoNothing();
    },

    /**
     * Puts a `failed` document back in the queue (status `queued`, error cleared).
     * The caller then sends the job. Returns "not_failed" for a document in any other
     * state and "not_found" for one that is not in this organization.
     */
    async retryDocument(documentId: string): Promise<"retried" | "not_found" | "not_failed"> {
      if (!UUID.test(documentId)) return "not_found";
      const updated = await db
        .update(documents)
        .set({ status: "queued", error: null })
        .where(inOrg(documents, eq(documents.id, documentId), eq(documents.status, "failed")))
        .returning({ id: documents.id });
      if (updated.length > 0) return "retried";
      return (await getDocument(documentId)) ? "not_failed" : "not_found";
    },
  };
}
