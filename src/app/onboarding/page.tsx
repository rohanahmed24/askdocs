import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { listMemberships } from "@/server/orgs";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Create your organization" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if ((await listMemberships(db, session.user.id)).length > 0) redirect("/documents");

  return (
    <AuthShell>
      <div className="flex flex-col gap-3">
        <p className="eyebrow">One more step</p>
        <h1 className="font-display text-5xl leading-none">Create your organization</h1>
        <p className="text-ink-muted">Documents and questions belong to an organization. You will be its owner and can invite others later.</p>
      </div>
      <OrganizationForm />
    </AuthShell>
  );
}
