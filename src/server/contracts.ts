import type { Tx } from "@/db";

/**
 * Contracts for the quota and chunker pieces (see docs/phase-2-contracts.md).
 * The rest of the code depends on these types, so each piece can be changed and
 * tested on its own.
 */

/** Thrown by `reserveStorage` when an upload would push the organization over its limit. */
export class QuotaExceededError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly usedBytes: number,
  ) {
    super("Storage quota exceeded");
    this.name = "QuotaExceededError";
  }
}

/**
 * Adds `bytes` to the organization's `storage_used_bytes` inside the caller's
 * transaction, after locking the organization row (SELECT ... FOR UPDATE).
 * Throws `QuotaExceededError` and changes nothing if the result would exceed
 * `storage_limit_bytes`.
 */
export type ReserveStorage = (tx: Tx, orgId: string, bytes: number) => Promise<void>;

/** Splits plain text into overlapping chunks, in reading order. */
export type Chunker = (text: string) => string[];
