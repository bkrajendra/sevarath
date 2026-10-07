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

describe('OutboxPublisherService.publishOne', () => {
  it('enqueues the job and marks the row published on success', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new OutboxPublisherService(db as any, queue as any);
    const row = makeRow();

    await service.publishOne(row);

    expect(queue.add).toHaveBeenCalledWith(
      'RideRequested',
      expect.objectContaining({
        eventId: 'event-1',
        eventType: 'RideRequested',
        aggregateType: 'ride',
        aggregateId: 'ride-1',
        payload: { foo: 'bar' },
        correlationId: null,
        occurredAt: row.createdAt.toISOString(),
      }),
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: expect.any(Date) }));
  });

  it('bumps retry_count and records last_error on enqueue failure, without touching published_at', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const service = new OutboxPublisherService(db as any, queue as any);
    const row = makeRow({ retryCount: 2 });

    await service.publishOne(row);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({ retryCount: 3, lastError: 'redis down' });
  });

  it('does not throw and lets the caller continue when enqueue fails', async () => {
    const db = makeDbMock();
    const queue = { add: jest.fn().mockRejectedValue(new Error('boom')) };
    const service = new OutboxPublisherService(db as any, queue as any);

    await expect(service.publishOne(makeRow())).resolves.toBeUndefined();
  });
});
