import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { QuotaExceededError, type ReserveStorage } from "./contracts";

type QuotaRow = { storage_limit_bytes: string; storage_used_bytes: string };

/**
 * Reserves `bytes` of the organization's storage quota inside the caller's transaction.
 *
 * The organization row is locked with `SELECT ... FOR UPDATE` before the counter
 * is read. Two uploads for the same organization therefore run one after the
 * other: the second one sees the first one's reservation, so the organization
 * can never end up over its limit. The lock is released when the caller's
 * transaction commits or rolls back, which also undoes the reservation if the
 * document insert that follows fails.
 *
 * Throws `QuotaExceededError` and changes nothing when the upload does not fit.
 * An upload that exactly fills the limit is allowed.
 */
export const reserveStorage: ReserveStorage = async (tx, orgId, bytes) => {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError(`Cannot reserve ${bytes} bytes: expected a positive integer`);
  }

  const { rows } = await tx.execute<QuotaRow>(sql`
    SELECT storage_limit_bytes, storage_used_bytes
    FROM organizations
    WHERE id = ${orgId}
    FOR UPDATE
  `);
  const org = rows[0];
  if (!org) throw new Error(`Organization ${orgId} does not exist`);

  // Postgres returns bigint columns as strings.
  const limitBytes = Number(org.storage_limit_bytes);
  const usedBytes = Number(org.storage_used_bytes);
  if (usedBytes + bytes > limitBytes) throw new QuotaExceededError(limitBytes, usedBytes);

  await tx.execute(sql`
    UPDATE organizations
    SET storage_used_bytes = storage_used_bytes + ${bytes}
    WHERE id = ${orgId}
  `);
};

/**
 * Gives `bytes` back to the organization's quota inside the caller's
 * transaction, never going below zero. Call it in the same transaction that
 * deletes the document, so the counter and the documents cannot disagree.
 */
export async function releaseStorage(tx: Tx, orgId: string, bytes: number): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError(`Cannot release ${bytes} bytes: expected a whole number of zero or more`);
  }
  if (bytes === 0) return;
  await tx.execute(sql`
    UPDATE organizations
    SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes})
    WHERE id = ${orgId}
  `);
}
