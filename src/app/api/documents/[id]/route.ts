import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { OrgAccessError, getOrgScope } from "@/server/org-scope";
import { listMemberships } from "@/server/orgs";

/** Deletes one of the signed-in user's documents and gives its size back to the quota. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to delete documents." }, { status: 401 });

  const [membership] = await listMemberships(db, session.user.id);
  if (!membership) return NextResponse.json({ error: "Create an organization first." }, { status: 403 });

  const { id } = await ctx.params;
  try {
    const scope = await getOrgScope(db, session.user.id, membership.orgId);
    const deleted = await scope.deleteDocument(id);
    if (!deleted) return NextResponse.json({ error: "That document does not exist." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof OrgAccessError) {
      return NextResponse.json({ error: err.reason === "not_owner" ? "Only an owner can delete documents that someone else uploaded." : err.message }, { status: 403 });
    }
    throw err;
  }
}
