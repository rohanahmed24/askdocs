/** Server-only transactional delivery. Never expose the provider key or reset link in logs. */
export async function sendPasswordResetEmail(to: string, url: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  const base = process.env.BETTER_AUTH_URL;
  if (!key || !from || !base) throw new Error("Password recovery email is not configured");
  const link = new URL(url);
  if (link.origin !== new URL(base).origin || !link.pathname.startsWith("/api/auth/reset-password/")) {
    throw new Error("Invalid password recovery URL");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reset your AskDocs password",
      text: `Someone requested a password reset for your AskDocs account.\n\nOpen this link to choose a new password:\n${link.href}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email. Your password has not changed.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Password recovery email delivery failed");
}
