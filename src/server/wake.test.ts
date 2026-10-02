import { describe, expect, it, vi } from "vitest";
import { WAKE_AFTER_MS, createWaker, needsWake } from "./wake";

const now = new Date("2026-10-02T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("needsWake", () => {
  it("is true for a document that has waited longer than the limit", () => {
    expect(needsWake([{ status: "queued", updatedAt: ago(WAKE_AFTER_MS + 1000) }], now)).toBe(true);
    expect(needsWake([{ status: "processing", updatedAt: ago(WAKE_AFTER_MS + 1000) }], now)).toBe(true);
  });

  it("is false for a document that was only just queued", () => {
    expect(needsWake([{ status: "queued", updatedAt: ago(5000) }], now)).toBe(false);
  });

  it("is false for finished documents and for an empty list", () => {
    expect(needsWake([{ status: "ready", updatedAt: ago(1e9) }, { status: "failed", updatedAt: ago(1e9) }], now)).toBe(false);
    expect(needsWake([], now)).toBe(false);
  });
});

describe("createWaker", () => {
  const ok = () => Promise.resolve(new Response("ok", { status: 200 }));

  it("does nothing when no worker URL is set", async () => {
    const fetchFn = vi.fn<typeof fetch>(ok);
    expect(await createWaker({ getUrl: () => undefined, fetch: fetchFn })()).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pings /health and reports that the worker answered", async () => {
    const fetchFn = vi.fn<typeof fetch>(ok);
    expect(await createWaker({ getUrl: () => "https://worker.example.com/", fetch: fetchFn })()).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://worker.example.com/health");
  });

  it("skips a second ping that comes too soon, then pings again after the interval", async () => {
    let t = 1_000_000;
    const fetchFn = vi.fn<typeof fetch>(ok);
    const wake = createWaker({ getUrl: () => "https://w.test", fetch: fetchFn, now: () => t, minIntervalMs: 60_000 });

    expect(await wake()).toBe(true);
    t += 10_000;
    expect(await wake()).toBe(false);
    t += 60_000;
    expect(await wake()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("never throws when the worker is unreachable, and says it failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wake = createWaker({ getUrl: () => "https://w.test", fetch: () => Promise.reject(new Error("timeout")) });

    await expect(wake()).resolves.toBe(false);
    warn.mockRestore();
  });

  it("reports false when the worker answers with an error status", async () => {
    const wake = createWaker({ getUrl: () => "https://w.test", fetch: () => Promise.resolve(new Response("bad", { status: 502 })) });
    expect(await wake()).toBe(false);
  });
});
