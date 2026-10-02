import { timingSafeEqual } from "node:crypto";

/**
 * Checks the `Authorization: Bearer <secret>` header that Vercel Cron sends
 * when `CRON_SECRET` is set. Refuses everything when no secret is configured.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
