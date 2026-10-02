import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getSession()) redirect("/documents");
  return (
    <AuthShell>
      <AuthForm mode="sign-in" />
    </AuthShell>
  );
}
