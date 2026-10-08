import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { refreshTokens } from '../db/schema';

/** How often the sweep runs. Housekeeping, not latency-sensitive - same cadence rationale as
 * `IdempotencyCleanupService` (docs/open-items.md #16): no reason to poll faster. */
export const REFRESH_TOKEN_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * How long a row is kept after it becomes revoked-or-expired before it's deleted. architecture.md
 * doesn't ask for this job by name (it's this task's own addition, not a spec requirement), so
 * there's no externally-given number to match - picked 7 days as a sane default: long enough
 * that a revoked/expired row stays around for any forensic look-back after a reuse-detection
 * event (docs/open-items.md's "revoke the whole user" row) or a support investigation into "why
 * was I logged out everywhere", short enough that this table - one row per refresh token ever
 * issued, unlike `idempotency_keys`' much smaller footprint - doesn't grow unbounded for an app
 * issuing a 30-day-TTL refresh token to every active user on every login and every rotation.
 * A *still-active* (unrevoked, unexpired) row is never touched by this job regardless of age.
 */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * TTL/housekeeping job for `refresh_tokens` - without it, every revoked (rotated-away or
 * logged-out) and every naturally-expired row would sit in the table forever. Mirrors
 * `IdempotencyCleanupService`'s `@Interval`-based sweep pattern.
 */
@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Interval(REFRESH_TOKEN_CLEANUP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const deleted = await this.deleteStaleRows();
    if (deleted > 0) {
      this.logger.log(`Refresh token sweep: deleted ${deleted} revoked/expired row(s)`);
    }
  }

  async deleteStaleRows(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const staleCondition = or(
      and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, cutoff)),
      lt(refreshTokens.expiresAt, cutoff),
    );

    const stale = await this.db.select({ id: refreshTokens.id }).from(refreshTokens).where(staleCondition);
    if (stale.length === 0) {
      return 0;
    }
    const staleIds = stale.map((r) => r.id);

    // Clear any forward reference *into* a row we're about to delete before deleting it - a row
    // that is itself not stale (e.g. revoked only recently) can still have `replacedByTokenId`
    // pointing at an older row that IS stale, and `refresh_tokens_replaced_by_token_id_...` is a
    // self-referencing FK with no cascade, so deleting the referenced row first would violate it.
    await this.db
      .update(refreshTokens)
      .set({ replacedByTokenId: null })
      .where(inArray(refreshTokens.replacedByTokenId, staleIds));

    const deleted = await this.db
      .delete(refreshTokens)
      .where(inArray(refreshTokens.id, staleIds))
      .returning({ id: refreshTokens.id });
    return deleted.length;
  }
}
