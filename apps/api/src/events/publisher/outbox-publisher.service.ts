import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { outboxEvents, type OutboxEvent } from '../../db/schema';
import { DOMAIN_EVENTS_QUEUE, NOTIFICATION_EVENTS_QUEUE } from '../outbox.constants';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 20;

export interface DomainEventJob {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  occurredAt: string;
}

/**
 * Polls `outbox_events` for unpublished rows and hands each to *both* the `domain-events`
 * BullMQ queue (WebSocket forwarding, Phase 5) and the `notification-events` BullMQ queue (push
 * notifications, Phase 7), marking it published on success. See architecture.md §4.3.
 *
 * Fan-out/"both must succeed" decision (docs/open-items.md): a row is only marked `published_at`
 * once BOTH enqueues succeed. architecture.md explicitly calls WebSocket delivery
 * "best-effort", and push notifications are the other best-effort channel - this treats the
 * pair as one logical publish of "this event, to every channel that wants it", rather than
 * tracking per-channel publish state (which the current `outbox_events` schema has no column
 * for anyway - `published_at` is a single timestamp). The tradeoff: if the first `queue.add`
 * succeeds and the second throws, the whole row is retried (via the existing
 * `retry_count`/`last_error` bookkeeping) and the first queue gets a *second*, duplicate job for
 * the same row on the next poll. That's an acceptable cost here - both downstream consumers
 * (WebSocket forwarding, push sends) are idempotent-ish in effect (at most a duplicate socket
 * event or a duplicate push notification, never a duplicate state change), consistent with the
 * "best-effort delivery" doctrine already governing both channels - rather than silently
 * dropping an event from one channel just because the other succeeded.
 *
 * NOTE: the poll query below is a plain, non-locking `SELECT ... LIMIT`, not a
 * `SELECT ... FOR UPDATE SKIP LOCKED`. That's fine with exactly one publisher instance
 * (today's deployment), but it would double-publish rows if this service were ever
 * scaled to multiple replicas - see docs/open-items.md.
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @InjectQueue(DOMAIN_EVENTS_QUEUE) private readonly queue: Queue,
    @InjectQueue(NOTIFICATION_EVENTS_QUEUE) private readonly notificationQueue: Queue,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async pollAndPublish(): Promise<void> {
    const pending = await this.db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(BATCH_SIZE);

    for (const row of pending) {
      await this.publishOne(row);
    }
  }

  /** Enqueues one row; on success marks it published, on failure bumps retry bookkeeping. */
  async publishOne(row: OutboxEvent): Promise<void> {
    try {
      const job: DomainEventJob = {
        eventId: row.id,
        eventType: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload as Record<string, unknown>,
        correlationId: row.correlationId,
        occurredAt: row.createdAt.toISOString(),
      };

      // Both must succeed before this row is marked published - see class doc comment above.
      await Promise.all([this.queue.add(row.eventType, job), this.notificationQueue.add(row.eventType, job)]);

      await this.db
        .update(outboxEvents)
        .set({ publishedAt: new Date() })
        .where(eq(outboxEvents.id, row.id));
    } catch (error) {
      await this.markFailed(row, error);
    }
  }

  private async markFailed(row: OutboxEvent, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Failed to publish outbox event ${row.id} (${row.eventType}): ${message}`);
    await this.db
      .update(outboxEvents)
      .set({ retryCount: row.retryCount + 1, lastError: message })
      .where(eq(outboxEvents.id, row.id));
  }
}
