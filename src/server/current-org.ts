import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { listMemberships } from "./orgs";

/**
 * For pages that need a signed-in user who belongs to an organization.
 * Sends everyone else to sign in or to create an organization.
 * (One organization per account for now, so this returns the first one.)
 */
export async function requireOrg() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [org] = await listMemberships(db, session.user.id);
  if (!org) redirect("/onboarding");
  return { session, org };
}
