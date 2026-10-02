import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { answerQuestion, checkQuestionLimit } from "@/server/chat/answer";
import { getChatDeps } from "@/server/chat/config";
import { OrgAccessError, getOrgScope, type OrgScope } from "@/server/org-scope";
import { listMemberships } from "@/server/orgs";

// An answer streams for up to a minute or so, and may wait for a slow free model.
export const maxDuration = 60;

const body = z.object({ question: z.string().trim().min(1, "Type a question.").max(1000, "Keep the question under 1000 characters.") });

/**
 * Answers a question from the signed-in user's organization, as a stream of
 * newline-separated JSON events (see `ChatEvent`): the numbered passages found,
 * the answer text piece by piece, then the cited passages.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to ask questions." }, { status: 401 });

  const [membership] = await listMemberships(db, session.user.id);
  if (!membership) return NextResponse.json({ error: "Create an organization first." }, { status: 403 });

  let scope: OrgScope;
  try {
    scope = await getOrgScope(db, session.user.id, membership.orgId);
  } catch (err) {
    if (err instanceof OrgAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Type a question." }, { status: 400 });
  const question = parsed.data.question;

  const limit = await checkQuestionLimit(scope);
  if (limit.remaining === 0) {
    return NextResponse.json({ error: limit.message, retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });
  }

  let deps;
  try {
    deps = getChatDeps();
  } catch (err) {
    console.error("Chat is not configured", err);
    return NextResponse.json({ error: "Chat is not set up on this server yet." }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of answerQuestion({ ...deps, scope, signal: request.signal }, question)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("Chat stream failed", err);
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "The answer could not be written. Try again.", remaining: limit.remaining - 1 }) + "\n"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
