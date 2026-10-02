import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, organizations, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createOrganizationForUser, listMemberships } from "./orgs";

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("organizations (database)", () => {
  const { db, pool } = createTestDb();

  async function addUser(id: string) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com` });
  }

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the organization and makes the creator its owner", async () => {
    await addUser("u1");
    const org = await createOrganizationForUser(db, { userId: "u1", name: "Northwind Studio" });

    expect(org.slug).toBe("northwind-studio");
    expect(org.storageUsedBytes).toBe(0);
    const rows = await db.select().from(memberships).where(eq(memberships.orgId, org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "u1", role: "owner" });
  });

  it("gives two organizations with the same name different slugs", async () => {
    await addUser("u1");
    await addUser("u2");
    const a = await createOrganizationForUser(db, { userId: "u1", name: "Acme" });
    const b = await createOrganizationForUser(db, { userId: "u2", name: "Acme" });

    expect(a.slug).toBe("acme");
    expect(b.slug).not.toBe("acme");
    expect(b.slug.startsWith("acme-")).toBe(true);
  });

  it("rolls back the organization if the membership insert fails", async () => {
    // No such user: the membership foreign key fails, so nothing may be left behind.
    await expect(createOrganizationForUser(db, { userId: "ghost", name: "Orphan Inc" })).rejects.toThrow();
    const orgs = await db.select().from(organizations);
    expect(orgs).toHaveLength(0);
  });

  it("lists only the organizations the user belongs to", async () => {
    await addUser("u1");
    await addUser("u2");
    await createOrganizationForUser(db, { userId: "u1", name: "Alpha" });
    await createOrganizationForUser(db, { userId: "u2", name: "Beta" });

    const mine = await listMemberships(db, "u1");
    expect(mine.map((m) => m.name)).toEqual(["Alpha"]);
    expect(mine[0].role).toBe("owner");
  });
});
