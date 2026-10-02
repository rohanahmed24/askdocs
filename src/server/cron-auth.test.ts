import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron-auth";

describe("isAuthorizedCron", () => {
  it("accepts the matching bearer token", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong or missing token", () => {
    expect(isAuthorizedCron("Bearer other", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});
