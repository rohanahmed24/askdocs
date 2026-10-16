import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPasswordResetEmail } from "./reset-email";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure() {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "AskDocs <no-reply@example.com>");
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
}
describe("password reset email", () => {
  it("sends the framework-generated link only to the requested recipient", async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const url = "https://app.example.com/api/auth/reset-password/test-token?callbackURL=%2Freset-password";
    await sendPasswordResetEmail("user@example.com", url);
    expect(fetcher).toHaveBeenCalledOnce();
    const [endpoint, options] = fetcher.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    const body = JSON.parse(options.body);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.text).toContain(url);
    expect(body.text).toContain("30 minutes");
  });
  it("refuses untrusted reset origins without sending", async () => {
    configure();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(sendPasswordResetEmail("user@example.com", "https://evil.example/api/auth/reset-password/token")).rejects.toThrow("Invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed without configuration", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(sendPasswordResetEmail("user@example.com", "https://app.example.com")).rejects.toThrow("not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not surface provider response bodies containing sensitive data", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret provider details", { status: 429 })));
    await expect(sendPasswordResetEmail("user@example.com", "https://app.example.com/api/auth/reset-password/token")).rejects.toThrow("Password recovery email delivery failed");
  });
});
