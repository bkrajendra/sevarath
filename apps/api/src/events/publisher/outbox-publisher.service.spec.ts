import { OutboxPublisherService } from './outbox-publisher.service';
import type { OutboxEvent } from '../../db/schema';

function makeRow(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'event-1',
    eventType: 'RideRequested',
    aggregateType: 'ride',
    aggregateId: 'ride-1',
    payload: { foo: 'bar' },
    correlationId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    publishedAt: null,
    retryCount: 0,
    lastError: null,
    ...overrides,
  };
}

/** Minimal mock of drizzle's chainable `db.update(...).set(...).where(...)` call. */
function makeDbMock() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  return { update, set, where } as const;
}

/**
 * These specs cover the Phase 7 fan-out change: `publishOne` now enqueues the same job onto
 * *both* `DOMAIN_EVENTS_QUEUE` (WebSocket forwarding) and `NOTIFICATION_EVENTS_QUEUE` (push
 * notifications) - a BullMQ queue is a work queue, not pub/sub, so a second consumer on the
 * *same* queue would only steal jobs from the first, not get its own copy (see
 * docs/open-items.md). A row is only marked `published_at` once BOTH enqueues succeed
 * ("both must succeed" - see the class doc comment on OutboxPublisherService) - if either
 * throws, the whole row is left unpublished and retried via the existing retry_count/
 * last_error bookkeeping, same as a single-queue failure always worked.
 */
describe('OutboxPublisherService.publishOne', () => {
  it('enqueues the job onto both queues and marks the row published when both succeed', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new OutboxPublisherService(db as any, queue as any, notificationQueue as any);
    const row = makeRow();

    await service.publishOne(row);

    const expectedJob = expect.objectContaining({
      eventId: 'event-1',
      eventType: 'RideRequested',
      aggregateType: 'ride',
      aggregateId: 'ride-1',
      payload: { foo: 'bar' },
      correlationId: null,
      occurredAt: row.createdAt.toISOString(),
    });
    expect(queue.add).toHaveBeenCalledWith('RideRequested', expectedJob);
    expect(notificationQueue.add).toHaveBeenCalledWith('RideRequested', expectedJob);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: expect.any(Date) }));
  });

  it('bumps retry_count and records last_error without touching published_at when the domain queue fails', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new OutboxPublisherService(db as any, queue as any, notificationQueue as any);
    const row = makeRow({ retryCount: 2 });

    await service.publishOne(row);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({ retryCount: 3, lastError: 'redis down' });
  });

  it('bumps retry_count and records last_error without touching published_at when only the notification queue fails', async () => {
    // Proves the "both must succeed" decision: the domain-events enqueue succeeding is not
    // enough on its own to mark the row published if the notification-events enqueue fails.
    const db = makeDbMock();
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const notificationQueue = { add: jest.fn().mockRejectedValue(new Error('notification queue down')) };
    const service = new OutboxPublisherService(db as any, queue as any, notificationQueue as any);
    const row = makeRow({ retryCount: 0 });

    await service.publishOne(row);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({ retryCount: 1, lastError: 'notification queue down' });
    expect(db.set).not.toHaveBeenCalledWith(expect.objectContaining({ publishedAt: expect.anything() }));
  });

  it('does not throw and lets the caller continue when either enqueue fails', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockRejectedValue(new Error('boom')) };
    const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new OutboxPublisherService(db as any, queue as any, notificationQueue as any);

    await expect(service.publishOne(makeRow())).resolves.toBeUndefined();
  });
});
