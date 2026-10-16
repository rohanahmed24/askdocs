import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { after } from "next/server";
import { passwordRecoveryOptions } from "./password-recovery";
import { sendPasswordResetEmail } from "./reset-email";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    ...passwordRecoveryOptions,
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      // Keep delivery alive on serverless without exposing account existence through email latency.
      after(async () => {
        try {
          await sendPasswordResetEmail(user.email, url);
        } catch {
          // Never log recipients, reset URLs, tokens or provider response bodies.
          console.error("Password reset email delivery failed. Check email provider configuration.");
        }
      });
    },
  },
  // Lets server actions set the session cookie.
  plugins: [nextCookies()],
});
