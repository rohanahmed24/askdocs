import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <AuthShell><PasswordRecoveryForm mode="request" /></AuthShell>;
}
