import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { outboxEvents } from '../../db/schema';
import { OutboxService } from './outbox.service';

describe('OutboxService (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: OutboxService;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new OutboxService();
  });

  afterAll(async () => {
    await pool.end();
  });

  const aggregateId = '11111111-1111-1111-1111-111111111111';

  afterEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId));
  });

  it('leaves no row when the enclosing transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await service.record(tx, {
          eventType: 'RideRequested',
          aggregateType: 'ride',
          aggregateId,
          payload: { rideId: aggregateId },
        });
        throw new Error('simulated rollback');
      }),
    ).rejects.toThrow('simulated rollback');

    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId));
    expect(rows).toHaveLength(0);
  });

  it('leaves exactly one row with the right fields when the transaction commits', async () => {
    const correlationId = '22222222-2222-2222-2222-222222222222';

    await db.transaction(async (tx) => {
      await service.record(tx, {
        eventType: 'RideRequested',
        aggregateType: 'ride',
        aggregateId,
        payload: { rideId: aggregateId, foo: 'bar' },
        correlationId,
      });
    });

    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId));
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row.eventType).toBe('RideRequested');
    expect(row.aggregateType).toBe('ride');
    expect(row.aggregateId).toBe(aggregateId);
    expect(row.payload).toEqual({ rideId: aggregateId, foo: 'bar' });
    expect(row.correlationId).toBe(correlationId);
    expect(row.publishedAt).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.lastError).toBeNull();
  });
});
