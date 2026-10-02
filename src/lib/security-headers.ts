/**
 * Response headers sent with every page and API response. Vercel already adds
 * Strict-Transport-Security. A Content-Security-Policy is not set: Next.js
 * inlines scripts, so a strict one needs per-request nonces (decision #26).
 */
export const securityHeaders = [
  // The browser must trust the declared content type, so an uploaded file can never be run as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing in the app is meant to be shown inside another site's frame (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
