import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { startHealthServer } from "./health";

describe("startHealthServer", () => {
  let close: () => void = () => {};
  afterAll(() => close());

  it("answers 200 on /health and 404 elsewhere", async () => {
    const server = await startHealthServer(0);
    close = () => server.close();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect((await fetch(`${base}/health?x=1`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(404);
  });
});
