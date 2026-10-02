// The worker runs on a free host that sleeps when it gets no traffic. These
// helpers decide when it needs waking and send the ping. Queued jobs live in
// Postgres, so a sleeping worker loses nothing: it picks them up when it starts.

/** A document that has waited this long in `queued` or `processing` means the worker is probably asleep. */
export const WAKE_AFTER_MS = 60_000;

type WaitingDoc = { status: string; updatedAt: Date };

/** True when some document has waited longer than `WAKE_AFTER_MS` for the worker. */
export function needsWake(docs: WaitingDoc[], now: Date = new Date()): boolean {
  return docs.some((d) => (d.status === "queued" || d.status === "processing") && now.getTime() - d.updatedAt.getTime() > WAKE_AFTER_MS);
}

export type WakerDeps = {
  /** Base URL of the worker. Defaults to `WORKER_URL`; with none set, waking does nothing. */
  getUrl?: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long to wait for the worker to answer. A cold start takes about a minute. */
  timeoutMs?: number;
  /** Pings closer together than this are skipped. */
  minIntervalMs?: number;
};

/**
 * Builds a function that pings the worker's `/health`, which starts a sleeping
 * host. It never throws. Resolves to true when the worker answered, false when
 * the ping was skipped (no URL, or too soon after the last one) or failed.
 */
export function createWaker(deps: WakerDeps = {}) {
  const getUrl = deps.getUrl ?? (() => process.env.WORKER_URL);
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const minIntervalMs = deps.minIntervalMs ?? 60_000;
  let lastPing = Number.NEGATIVE_INFINITY;

  return async function wake(): Promise<boolean> {
    const base = getUrl();
    if (!base) return false;
    if (now() - lastPing < minIntervalMs) return false;
    lastPing = now();

    try {
      const response = await doFetch(`${base.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      return response.ok;
    } catch (err) {
      console.warn("Could not wake the worker", err);
      return false;
    }
  };
}

/** Shared by the routes in this app. */
export const wakeWorker = createWaker();
