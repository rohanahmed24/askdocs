import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { createDocument } from "@/server/documents";
import { MAX_UPLOAD_BYTES } from "@/server/extract";
import { enqueueIngestion } from "@/server/jobs";
import { listMemberships } from "@/server/orgs";
import { reserveStorage } from "@/server/quota";

const statusByReason = { unsupported_type: 415, empty: 400, too_large: 413, quota: 409 } as const;

/**
 * Upload one document: multipart/form-data with a `file` field.
 *
 * The organization is looked up from the signed-in user's memberships on the
 * server. It is never taken from the request, so a client cannot upload into
 * someone else's organization.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to upload documents." }, { status: 401 });

  const [org] = await listMemberships(db, session.user.id);
  if (!org) return NextResponse.json({ error: "Create an organization before uploading." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a file in the `file` field." }, { status: 400 });
  // Check the size before reading the bytes into memory.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Each file can be up to 10 MB. Compress the file or split it." }, { status: 413 });
  }

  const result = await createDocument(
    db,
    { reserveStorage, enqueue: enqueueIngestion },
    { orgId: org.orgId, userId: session.user.id, filename: file.name, data: new Uint8Array(await file.arrayBuffer()) },
  );

  if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: statusByReason[result.reason] });
  const { id, filename, status } = result.document;
  return NextResponse.json({ id, filename, status }, { status: 201 });
}
