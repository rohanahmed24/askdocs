import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats zero and invalid input as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("uses whole numbers for bytes and KB, one decimal from MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(18 * 1024)).toBe("18 KB");
    expect(formatBytes(10.2 * 1024 * 1024)).toBe("10.2 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});
