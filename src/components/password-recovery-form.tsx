"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./button";
import { FormError } from "./form-error";
import { TextField } from "./text-field";

export function PasswordRecoveryForm({ mode, token }: { mode: "request" | "reset"; token?: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(mode === "reset" && !token);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    const password = String(form.get("password") ?? "");
    if (mode === "reset" && password !== form.get("confirmPassword")) {
      setError("The passwords do not match. Please enter them again.");
      return;
    }
    setPending(true);
    try {
      const result = mode === "request"
        ? await authClient.requestPasswordReset({
            email: String(form.get("email") ?? "").trim(),
            redirectTo: `${window.location.origin}/reset-password`,
          })
        : await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        if (mode === "reset" && result.error.code === "INVALID_TOKEN") setInvalid(true);
        else setError(result.error.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : "We could not complete your request. Please try again.");
        return;
      }
      setDone(true);
      if (mode === "reset") window.history.replaceState(null, "", "/reset-password");
    } catch {
      setError("We could not connect. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="flex flex-col gap-3">
      <p className="eyebrow">Account recovery</p>
      <h1 className="font-display text-5xl leading-none">
        {done ? (mode === "request" ? "Check your email" : "Password updated") : mode === "request" ? "Forgot password?" : "Reset password"}
      </h1>
    </div>
    {done ? <p role="status" className="text-ink-muted">
      {mode === "request"
        ? "If an account exists for that email, a reset link will arrive shortly. Check your spam folder too. The link expires in 30 minutes."
        : "Your password has been updated and your previous sessions have been signed out. Sign in with your new password."}
    </p> : invalid ? <FormError message="This reset link is missing, invalid or expired. Request a new link below." /> : <>
      <p className="text-ink-muted">{mode === "request" ? "Enter your account email to request a password reset link." : "Choose a new password with 8–128 characters."}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
        {mode === "request" ? <TextField id="email" name="email" type="email" label="Email" autoComplete="email" required /> : <>
          <TextField id="password" name="password" type="password" label="New password" autoComplete="new-password" required minLength={8} maxLength={128} />
          <TextField id="confirmPassword" name="confirmPassword" type="password" label="Confirm new password" autoComplete="new-password" required minLength={8} maxLength={128} />
        </>}
        <FormError message={error} />
        <Button type="submit" disabled={pending}>{pending ? "One moment…" : mode === "request" ? "Send reset link" : "Reset password"}</Button>
      </form>
    </>}
    {(invalid || (done && mode === "request")) && <Link href="/forgot-password" className="underline underline-offset-4" onClick={() => { setDone(false); setError(null); }}>Request another link</Link>}
    <Link href="/sign-in" className="text-sm underline underline-offset-4">Back to sign in</Link>
  </>;
}
