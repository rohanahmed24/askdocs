import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { securityHeaders } from "./security-headers";

describe("security headers", () => {
  it("blocks framing and content type sniffing", () => {
    const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
  });

  it("are applied to every route by the Next.js config", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual(expect.arrayContaining([{ source: "/:path*", headers: securityHeaders }]));
    const reset = rules?.find((rule) => rule.source === "/reset-password");
    expect(reset?.headers).toEqual(expect.arrayContaining([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ]));
  });
});
