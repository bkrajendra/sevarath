import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { outboxEvents } from '../../db/schema';
import { OutboxPublisherService } from './outbox-publisher.service';

/** A fake BullMQ `Queue` whose `add` records every call and is artificially slow, to widen the
 * race window between two concurrent `pollAndPublish()` calls as much as possible. */
function makeSlowQueue(addedEventIds: string[], delayMs = 300) {
  return {
    add: jest.fn(async (_name: string, job: { eventId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      addedEventIds.push(job.eventId);
    }),
  };
}

/** Stand-in for MetricsService - this suite is about the SKIP LOCKED race, not metrics. */
function makeMetricsMock() {
  return {
    outboxPublishLatencySeconds: { observe: jest.fn() },
    outboxPublishFailuresTotal: { inc: jest.fn() },
  };
}

/**
 * Real-Postgres proof of docs/open-items.md #4's fix: `pollAndPublish`'s `SELECT ... FOR UPDATE
 * SKIP LOCKED` actually prevents two concurrent publisher instances (today's single process
 * never runs two, but the fix is specifically for when it someday does - a second replica, or a
 * dedicated publisher worker scaled past one instance) from both picking up, and therefore both
 * enqueuing, the same outbox row.
 *
 * Two separate `OutboxPublisherService` instances are constructed, each over its OWN `pg.Pool`
 * (so each `db.transaction()` call genuinely acquires its own connection, not a connection the
 * other is already holding at the client level) - this is what makes it a real test of
 * Postgres's own row-locking, not just of in-process JS concurrency.
 */
describe('OutboxPublisherService.pollAndPublish (integration, real Postgres, concurrency)', () => {
  let poolA: Pool;
  let poolB: Pool;
  let dbA: ReturnType<typeof drizzle<typeof schema>>;
  let dbB: ReturnType<typeof drizzle<typeof schema>>;
  const aggregateId = '33333333-3333-3333-3333-333333333333';

  beforeAll(() => {
    poolA = new Pool({ connectionString: process.env.DATABASE_URL });
    poolB = new Pool({ connectionString: process.env.DATABASE_URL });
    dbA = drizzle(poolA, { schema });
    dbB = drizzle(poolB, { schema });
  });

  afterEach(async () => {
    await dbA.delete(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId));
  });

  afterAll(async () => {
    await poolA.end();
    await poolB.end();
  });

  async function seedRows(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const [row] = await dbA
        .insert(outboxEvents)
        .values({
          eventType: 'RideRequested',
          aggregateType: 'ride',
          aggregateId,
          payload: { rideId: aggregateId, i },
        })
        .returning();
      ids.push(row.id);
    }
    return ids;
  }

  it('two concurrent pollAndPublish() calls never both enqueue the same row - each unpublished row is handled exactly once', async () => {
    const rowIds = await seedRows(6);

    const addedToDomainQueue: string[] = [];
    const addedToNotificationQueue: string[] = [];
    const domainQueueA = makeSlowQueue(addedToDomainQueue);
    const notificationQueueA = makeSlowQueue(addedToNotificationQueue);
    const domainQueueB = makeSlowQueue(addedToDomainQueue);
    const notificationQueueB = makeSlowQueue(addedToNotificationQueue);

    const serviceA = new OutboxPublisherService(dbA as any, domainQueueA as any, notificationQueueA as any, makeMetricsMock() as any);
    const serviceB = new OutboxPublisherService(dbB as any, domainQueueB as any, notificationQueueB as any, makeMetricsMock() as any);

    // Genuinely concurrent - both start before either has a chance to commit and release its
    // row locks. Without FOR UPDATE SKIP LOCKED, both would SELECT the same 6 rows.
    await Promise.all([serviceA.pollAndPublish(), serviceB.pollAndPublish()]);

    // Every row was enqueued - nothing was silently skipped by both instances at once.
    expect(addedToDomainQueue.sort()).toEqual([...rowIds].sort());
    expect(addedToNotificationQueue.sort()).toEqual([...rowIds].sort());

    // No row was enqueued twice - that's the actual thing SKIP LOCKED prevents.
    expect(new Set(addedToDomainQueue).size).toBe(rowIds.length);
    expect(new Set(addedToNotificationQueue).size).toBe(rowIds.length);

    // And every row ended up durably marked published in Postgres, exactly once each.
    const published = await dbA.select().from(outboxEvents).where(inArray(outboxEvents.id, rowIds));
    expect(published).toHaveLength(rowIds.length);
    for (const row of published) {
      expect(row.publishedAt).not.toBeNull();
    }
  }, 15000);

  it('a row locked by one in-flight transaction is skipped (not blocked on) by a concurrent poll, not double-counted', async () => {
    const [rowId] = await seedRows(1);

    const addedToDomainQueue: string[] = [];
    const slowQueue = makeSlowQueue(addedToDomainQueue, 500);
    const fastQueue = makeSlowQueue([], 0);
    const serviceSlow = new OutboxPublisherService(dbA as any, slowQueue as any, fastQueue as any, makeMetricsMock() as any);
    const serviceFast = new OutboxPublisherService(dbB as any, fastQueue as any, fastQueue as any, makeMetricsMock() as any);

    const slowRun = serviceSlow.pollAndPublish();
    // Give the slow run a head start so it has definitely acquired the row lock (SELECT ... FOR
    // UPDATE) and is sitting in its 500ms simulated enqueue before the second poll starts.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fastRun = serviceFast.pollAndPublish();

    await Promise.all([slowRun, fastRun]);

    // The row was enqueued exactly once (by the slow run, which held the lock), never by the
    // fast run that should have found nothing left to select (SKIP LOCKED, not BLOCKED).
    expect(addedToDomainQueue).toEqual([rowId]);

    const [row] = await dbA.select().from(outboxEvents).where(eq(outboxEvents.id, rowId));
    expect(row.publishedAt).not.toBeNull();
  }, 15000);
});
