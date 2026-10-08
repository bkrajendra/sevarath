import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { idempotencyKeys } from '../db/schema';

/** How often the sweep runs. Housekeeping, not latency-sensitive - no reason to poll faster. */
export const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * How long a COMPLETED row is kept before it's deleted. architecture.md §6.2 calls for "a TTL
 * cleanup job" but gives no specific number; docs/open-items.md's own entry on this gap
 * suggested 24-48h as a sane default - picked the long end (48h) since the whole point of a
 * completed row is to survive a client's own retry of a dropped response, and a client retrying
 * a mobile request after e.g. a weekend of no connectivity is a more realistic failure mode than
 * "needs the row gone sooner to save space" (this table is small - one row per mutating
 * request that ever used the header, not a high-volume log).
 */
export const COMPLETED_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * How long a row may sit IN_PROGRESS before it's treated as abandoned (the claiming request's
 * process crashed before the interceptor's own `catchError` cleanup - see
 * idempotency.interceptor.ts - ever ran, so the row was never deleted or marked COMPLETED). A
 * *normal* failure already cleans up its own row synchronously; this is specifically the
 * server-crash-mid-request case. None of the five idempotency-guarded endpoints does anything
 * that should legitimately take anywhere near this long (they're each a handful of DB
 * statements in one transaction), so 10 minutes is generously above any realistic request
 * duration while still being short enough that a genuinely stuck key doesn't wedge a client's
 * retries for hours.
 */
export const IN_PROGRESS_RECLAIM_MS = 10 * 60 * 1000; // 10 minutes

/**
 * TTL/housekeeping job for `idempotency_keys`, closing the gap architecture.md §6.2 explicitly
 * calls for (docs/open-items.md #16): rows were never deleted or expired before this. Two
 * separate sweeps, since they answer two different questions:
 *
 *  - COMPLETED rows past `COMPLETED_RETENTION_MS`: the row has done its job (any realistic
 *    client retry window has passed) - just delete it.
 *  - IN_PROGRESS rows past `IN_PROGRESS_RECLAIM_MS`: NOT a normal failure (the interceptor's own
 *    `catchError` already deletes the row synchronously on a normal error - see
 *    idempotency.interceptor.ts). This is specifically the server-crash-mid-request case: the
 *    row was claimed, the process died before completing or erroring, and the key is now wedged
 *    forever (the unique index on (userId, route, idempotencyKey) means no retry with the same
 *    key can ever succeed again) unless something reclaims it. Deleting it - exactly what the
 *    interceptor's own cleanup does for a normal failure - makes the key available for a fresh
 *    attempt again, which is the correct outcome: the original request never actually completed.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Interval(CLEANUP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const completedDeleted = await this.deleteExpiredCompleted();
    const reclaimed = await this.reclaimStuckInProgress();

    if (completedDeleted > 0 || reclaimed > 0) {
      this.logger.log(
        `Idempotency key sweep: deleted ${completedDeleted} expired COMPLETED row(s), reclaimed ${reclaimed} stuck IN_PROGRESS row(s)`,
      );
    }
  }

  async deleteExpiredCompleted(): Promise<number> {
    const cutoff = new Date(Date.now() - COMPLETED_RETENTION_MS);
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.status, 'COMPLETED'), lt(idempotencyKeys.completedAt, cutoff)))
      .returning({ id: idempotencyKeys.id });
    return deleted.length;
  }

  async reclaimStuckInProgress(): Promise<number> {
    const cutoff = new Date(Date.now() - IN_PROGRESS_RECLAIM_MS);
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.status, 'IN_PROGRESS'), lt(idempotencyKeys.createdAt, cutoff)))
      .returning({ id: idempotencyKeys.id });
    return deleted.length;
  }
}
