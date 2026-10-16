import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { passwordRecoveryOptions } from "./password-recovery";

function fixture() {
  const database = { user: [], session: [], account: [], verification: [] };
  const emails: { token: string; url: string }[] = [];
  const auth = betterAuth({
    baseURL: "http://localhost:3000", secret: "test-only-secret-at-least-32-characters-long",
    database: memoryAdapter(database), logger: { disabled: true },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    emailAndPassword: { enabled: true, ...passwordRecoveryOptions,
      sendResetPassword: async ({ token, url }) => { emails.push({ token, url }); },
    },
  });
  return { auth, emails };
}

describe("password recovery using Better Auth", () => {
  it("hides account existence, resets once, invalidates old password and sessions", async () => {
    const { auth, emails } = fixture();
    const original = await auth.api.signUpEmail({ body: { name: "Demo", email: "demo@example.com", password: "Original123!" } });
    const known = await auth.api.requestPasswordReset({ body: { email: "demo@example.com", redirectTo: "/reset-password" } });
    const unknown = await auth.api.requestPasswordReset({ body: { email: "absent@example.com", redirectTo: "/reset-password" } });
    expect(unknown).toEqual(known);
    expect(emails).toHaveLength(1);
    expect(emails[0].url).toContain("/api/auth/reset-password/");
    await auth.api.resetPassword({ body: { token: emails[0].token, newPassword: "Replacement123!" } });
    await expect(auth.api.signInEmail({ body: { email: "demo@example.com", password: "Original123!" } })).rejects.toThrow();
    expect(await auth.api.signInEmail({ body: { email: "demo@example.com", password: "Replacement123!" } })).toHaveProperty("token");
    await expect(auth.api.resetPassword({ body: { token: emails[0].token, newPassword: "Another123!" } })).rejects.toThrow();
    const context = await auth.$context;
    expect(await context.internalAdapter.findSession(original.token!)).toBeNull();
  });
  it("rejects invalid and expired links; a short password does not consume a valid link", async () => {
    const { auth, emails } = fixture();
    await auth.api.signUpEmail({ body: { name: "Demo", email: "demo@example.com", password: "Original123!" } });
    await auth.api.requestPasswordReset({ body: { email: "demo@example.com", redirectTo: "/reset-password" } });
    await expect(auth.api.resetPassword({ body: { token: "invalid", newPassword: "Replacement123!" } })).rejects.toThrow();
    await expect(auth.api.resetPassword({ body: { token: emails[0].token, newPassword: "short" } })).rejects.toThrow();
    await auth.api.resetPassword({ body: { token: emails[0].token, newPassword: "Replacement123!" } });
    const context = await auth.$context;
    const user = await context.internalAdapter.findUserByEmail("demo@example.com");
    await context.internalAdapter.createVerificationValue({ identifier: "reset-password:expired", value: user!.user.id, expiresAt: new Date(Date.now() - 1000) });
    await expect(auth.api.resetPassword({ body: { token: "expired", newPassword: "Another123!" } })).rejects.toThrow();
    const unsafe = await auth.handler(new Request("http://localhost:3000/api/auth/request-password-reset", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "demo@example.com", redirectTo: "https://evil.example/reset" }),
    }));
    expect(unsafe.status).toBe(403);
  });
});
