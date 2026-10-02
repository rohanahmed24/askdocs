"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./button";
import { FormError } from "./form-error";
import { TextField } from "./text-field";

const copy = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Sign in",
    submit: "Sign in",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/sign-up",
  },
  "sign-up": {
    eyebrow: "Get started",
    title: "Create your account",
    submit: "Create account",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode }: { mode: keyof typeof copy }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = copy[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: String(form.get("name") ?? ""), email, password })
        : await authClient.signIn.email({ email, password });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.");
      return;
    }
    router.push("/documents");
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="font-display text-5xl leading-none">{t.title}</h1>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {mode === "sign-up" && (
          <TextField id="name" name="name" label="Name" autoComplete="name" required minLength={2} />
        )}
        <TextField id="email" name="email" type="email" label="Email" autoComplete="email" required />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          required
          minLength={8}
        />
        {mode === "sign-up" && <p className="-mt-3 text-sm text-ink-muted">At least 8 characters.</p>}
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? "One moment…" : t.submit}
        </Button>
      </form>
      <p className="text-sm text-ink-muted">
        {t.switchText}{" "}
        <Link href={t.switchHref} className="font-medium text-ink underline underline-offset-4">
          {t.switchLabel}
        </Link>
      </p>
    </>
  );
}
