import { describe, expect, it } from "vitest";
import { slugify } from "./orgs";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Northwind Studio")).toBe("northwind-studio");
  });

  it("strips accents and punctuation", () => {
    expect(slugify("  Café   Müller & Co.  ")).toBe("cafe-muller-co");
  });

  it("falls back to a default for names with no usable characters", () => {
    expect(slugify("!!!")).toBe("org");
    expect(slugify("বাংলা")).toBe("org");
  });

  it("caps the length without leaving a trailing dash", () => {
    const slug = slugify("a".repeat(39) + " b" + " c");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});
