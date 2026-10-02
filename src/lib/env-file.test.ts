import { describe, expect, it } from "vitest";
import { checkSecretValue, setEnvValue } from "./env-file";

describe("setEnvValue", () => {
  it("replaces an existing empty line and leaves the rest alone", () => {
    const before = "A=1\nOPENROUTER_API_KEY=\nB=2\n";
    expect(setEnvValue(before, "OPENROUTER_API_KEY", "sk-or-xyz")).toBe("A=1\nOPENROUTER_API_KEY=sk-or-xyz\nB=2\n");
  });

  it("replaces an old value", () => {
    expect(setEnvValue("OPENROUTER_API_KEY=old\n", "OPENROUTER_API_KEY", "sk-or-new")).toBe("OPENROUTER_API_KEY=sk-or-new\n");
  });

  it("adds the line when it is missing, with or without a trailing newline", () => {
    expect(setEnvValue("A=1\n", "OPENROUTER_API_KEY", "sk-or-x")).toBe("A=1\nOPENROUTER_API_KEY=sk-or-x\n");
    expect(setEnvValue("A=1", "OPENROUTER_API_KEY", "sk-or-x")).toBe("A=1\nOPENROUTER_API_KEY=sk-or-x\n");
    expect(setEnvValue("", "OPENROUTER_API_KEY", "sk-or-x")).toBe("OPENROUTER_API_KEY=sk-or-x\n");
  });

  it("does not treat $ in a value as a regex replacement", () => {
    expect(setEnvValue("K=\n", "K", "a$&b$1")).toBe("K=a$&b$1\n");
  });

  it("does not touch a variable whose name only starts the same", () => {
    expect(setEnvValue("OPENROUTER_API_KEY_OLD=keep\n", "OPENROUTER_API_KEY", "sk-or-x")).toBe("OPENROUTER_API_KEY_OLD=keep\nOPENROUTER_API_KEY=sk-or-x\n");
  });
});

describe("checkSecretValue", () => {
  it("accepts a key with the right prefix", () => {
    expect(checkSecretValue("OPENROUTER_API_KEY", "sk-or-v1-abc123")).toBeNull();
  });

  it("refuses empty, wrong-prefix, multi-line and huge values", () => {
    expect(checkSecretValue("OPENROUTER_API_KEY", "")).toMatch(/Paste/);
    expect(checkSecretValue("OPENROUTER_API_KEY", "AIzaSyGoogleKey")).toMatch(/starts with "sk-or-"/);
    expect(checkSecretValue("OPENROUTER_API_KEY", "sk-or-a\nEVIL=1")).toMatch(/line breaks/);
    expect(checkSecretValue("OPENROUTER_API_KEY", "sk-or-" + "a".repeat(400))).toMatch(/too long/);
  });

  it("never repeats the value in its message", () => {
    expect(checkSecretValue("OPENROUTER_API_KEY", "AIza-secret-value")).not.toContain("secret-value");
  });
});
