import { and, desc, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { documents, memberships } from "@/db/schema";
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

export type OrgRole =typeof memberships.$inferSelect.role;

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
    async getDocument(documentId: string) {
      // A malformed id (for example from a URL) is simply "not found", not a database error.
      if (!UUID.test(documentId)) return null;
      const [doc] = await db
        .select()
        .from(documents)
        .where(inOrg(documents, eq(documents.id, documentId)))
        .limit(1);
      return doc ?? null;
    },
  };
}
