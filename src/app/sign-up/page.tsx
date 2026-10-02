import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getSession()) redirect("/documents");
  return (
    <AuthShell>
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
