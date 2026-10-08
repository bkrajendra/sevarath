import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { count, eq, isNull, notInArray } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { drivers, outboxEvents, rides } from '../db/schema';
import { TERMINAL_RIDE_STATUSES } from '../rides/ride-state-machine';
import { MetricsService } from './metrics.service';

/**
 * How often the gauge-backed metrics below are refreshed. Same `@Interval` pattern
 * `events/publisher/outbox-publisher.service.ts`/`common/idempotency-cleanup.service.ts`
 * already use - `@nestjs/schedule` manages/clears these on module destroy, so no new
 * dangling-timer risk (docs/open-items.md #19). Picked 20s: per the task brief's own
 * "every 15-30s" suggestion, these are dashboard-facing gauges, not latency-sensitive.
 */
export const METRICS_POLL_INTERVAL_MS = 20_000;

/**
 * Periodically recomputes the three gauge metrics that are cheaper and less error-prone to
 * poll outright than to track incrementally through every ride/driver/outbox transition
 * (architecture.md §10's own `active_rides`/`available_drivers`, plus `outbox_pending_events` -
 * see docs/open-items.md's guidance for this task): a straight `COUNT(*)` can never drift from
 * the real table state the way an incremental inc()/dec() pairing could if a code path ever
 * missed one side of the pair.
 */
@Injectable()
export class MetricsPollerService {
  private readonly logger = new Logger(MetricsPollerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly metrics: MetricsService,
  ) {}

  @Interval(METRICS_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    try {
      await Promise.all([this.pollActiveRides(), this.pollAvailableDrivers(), this.pollOutboxPending()]);
    } catch (error) {
      // A single failed poll (e.g. a transient DB hiccup) must never crash the interval/app -
      // the gauges simply keep their last-known value until the next successful poll.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Metrics poll failed: ${message}`);
    }
  }

  private async pollActiveRides(): Promise<void> {
    const [row] = await this.db
      .select({ value: count() })
      .from(rides)
      .where(notInArray(rides.status, TERMINAL_RIDE_STATUSES));
    this.metrics.activeRides.set(row?.value ?? 0);
  }

  private async pollAvailableDrivers(): Promise<void> {
    const [row] = await this.db
      .select({ value: count() })
      .from(drivers)
      .where(eq(drivers.availability, 'AVAILABLE'));
    this.metrics.availableDrivers.set(row?.value ?? 0);
  }

  private async pollOutboxPending(): Promise<void> {
    const [row] = await this.db
      .select({ value: count() })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));
    this.metrics.outboxPendingEvents.set(row?.value ?? 0);
  }
}
