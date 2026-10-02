"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { createOrganizationForUser, listMemberships } from "@/server/orgs";

const schema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(60, "Use 60 characters or fewer."),
});

export type OnboardingState = { error: string | null };

export async function createOrganizationAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter an organization name." };

  // One organization per account for now. Do not create a second one by accident.
  const existing = await listMemberships(db, session.user.id);
  if (existing.length === 0) {
    await createOrganizationForUser(db, { userId: session.user.id, name: parsed.data.name });
  }
  redirect("/documents");
}
