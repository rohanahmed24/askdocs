import { NextResponse, after } from "next/server";
import { isAuthorizedCron } from "@/server/cron-auth";
import { enqueueCleanup } from "@/server/jobs";
import { wakeWorker } from "@/server/wake";

/**
 * Called once a day by Vercel Cron (see vercel.json). The worker sleeps on a
 * free host and cannot run its own schedule, so this queues the nightly
 * cleanup and wakes the worker to run it. Vercel sends `CRON_SECRET` as a bearer token.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await enqueueCleanup();
  after(() => wakeWorker());
  return NextResponse.json({ ok: true });
}
