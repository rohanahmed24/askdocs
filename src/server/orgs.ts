import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { memberships, organizations } from "@/db/schema";

/** "Northwind Studio" -> "northwind-studio". Never returns an empty string. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "org";
}

/**
 * Creates an organization and makes the user its owner. Both inserts happen in
 * one transaction, so there is never an organization without an owner.
 * If the slug is taken, a short random suffix is added.
 */
export async function createOrganizationForUser(db: Db, input: { userId: string; name: string }) {
  const name = input.name.trim();
  const base = slugify(name);

  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
      const [org] = await tx
        .insert(organizations)
        .values({ name, slug })
        .onConflictDoNothing({ target: organizations.slug })
        .returning();
      if (org) {
        await tx.insert(memberships).values({ orgId: org.id, userId: input.userId, role: "owner" });
        return org;
      }
    }
    throw new Error("Could not allocate a unique organization slug");
  });
}

/** The organizations a user belongs to, oldest membership first. */
export async function listMemberships(db: Db, userId: string) {
  return db
    .select({
      orgId: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
      storageUsedBytes: organizations.storageUsedBytes,
      storageLimitBytes: organizations.storageLimitBytes,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}
