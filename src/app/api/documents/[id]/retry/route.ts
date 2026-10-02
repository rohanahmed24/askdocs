import { NextResponse, after } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { enqueueIngestion } from "@/server/jobs";
import { OrgAccessError, getOrgScope } from "@/server/org-scope";
import { listMemberships } from "@/server/orgs";
import { wakeWorker } from "@/server/wake";

/** Queues a failed document for indexing again. */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/retry">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to retry documents." }, { status: 401 });

  const [membership] = await listMemberships(db, session.user.id);
  if (!membership) return NextResponse.json({ error: "Create an organization first." }, { status: 403 });

  const { id } = await ctx.params;
  try {
    const scope = await getOrgScope(db, session.user.id, membership.orgId);
    const outcome = await scope.retryDocument(id);
    if (outcome === "not_found") return NextResponse.json({ error: "That document does not exist." }, { status: 404 });
    if (outcome === "not_failed") return NextResponse.json({ error: "Only a document that failed can be tried again." }, { status: 409 });
  } catch (err) {
    if (err instanceof OrgAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  // The document is queued in the database. If sending the job fails, the nightly cleanup queues it again.
  try {
    await enqueueIngestion(id);
  } catch (err) {
    console.error("Could not queue indexing; the nightly cleanup will retry", err);
  }
  after(() => wakeWorker());
  return NextResponse.json({ id, status: "queued" }, { status: 202 });
}
