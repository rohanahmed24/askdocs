import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = {
  title: "Reset password", robots: { index: false, follow: false }, referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" && !params.error ? params.token : undefined;
  return <AuthShell><PasswordRecoveryForm mode="reset" token={token} /></AuthShell>;
}
