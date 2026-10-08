import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { idempotencyKeys, users } from '../db/schema';
import {
  COMPLETED_RETENTION_MS,
  IN_PROGRESS_RECLAIM_MS,
  IdempotencyCleanupService,
} from './idempotency-cleanup.service';

describe('IdempotencyCleanupService (integration, real Postgres)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: IdempotencyCleanupService;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new IdempotencyCleanupService(db as any);

    const [user] = await db
      .insert(users)
      .values({ name: 'Idempotency Cleanup Test User', mobile: `idem-cleanup-${Date.now()}` })
      .returning();
    userId = user.id;
  });

  afterEach(async () => {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  async function insertRow(overrides: Partial<typeof idempotencyKeys.$inferInsert>) {
    const [row] = await db
      .insert(idempotencyKeys)
      .values({
        userId,
        route: 'RidesController#cleanupTest',
        idempotencyKey: `key-${Date.now()}-${Math.random()}`,
        status: 'IN_PROGRESS',
        ...overrides,
      })
      .returning();
    return row;
  }

  it('deleteExpiredCompleted deletes a COMPLETED row past the retention window, leaves a fresh one alone', async () => {
    const stale = await insertRow({
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - COMPLETED_RETENTION_MS - 60_000),
    });
    const fresh = await insertRow({ status: 'COMPLETED', completedAt: new Date() });

    const count = await service.deleteExpiredCompleted();

    expect(count).toBe(1);
    const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
    expect(rows.map((r) => r.id)).not.toContain(stale.id);
    expect(rows.map((r) => r.id)).toContain(fresh.id);
  });

  it('deleteExpiredCompleted never touches an IN_PROGRESS row, no matter how old', async () => {
    const oldInProgress = await insertRow({ status: 'IN_PROGRESS' });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - COMPLETED_RETENTION_MS - 60_000) })
      .where(eq(idempotencyKeys.id, oldInProgress.id));

    const count = await service.deleteExpiredCompleted();

    expect(count).toBe(0);
    const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.id, oldInProgress.id));
    expect(row).toBeDefined();
  });

  it('reclaimStuckInProgress deletes an IN_PROGRESS row past the reclaim window, leaving a fresh claim alone', async () => {
    const stuck = await insertRow({ status: 'IN_PROGRESS' });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - IN_PROGRESS_RECLAIM_MS - 60_000) })
      .where(eq(idempotencyKeys.id, stuck.id));
    const freshClaim = await insertRow({ status: 'IN_PROGRESS' });

    const count = await service.reclaimStuckInProgress();

    expect(count).toBe(1);
    const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
    expect(rows.map((r) => r.id)).not.toContain(stuck.id);
    expect(rows.map((r) => r.id)).toContain(freshClaim.id);
  });

  it('reclaimStuckInProgress never touches a COMPLETED row, no matter how old', async () => {
    const oldCompleted = await insertRow({ status: 'COMPLETED', completedAt: new Date() });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - IN_PROGRESS_RECLAIM_MS - 60_000) })
      .where(eq(idempotencyKeys.id, oldCompleted.id));

    const count = await service.reclaimStuckInProgress();

    expect(count).toBe(0);
    const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.id, oldCompleted.id));
    expect(row).toBeDefined();
  });

  it('a reclaimed IN_PROGRESS key can be claimed again (the unique index no longer blocks it)', async () => {
    const key = `key-${Date.now()}-reclaim-then-reclaim`;
    const stuck = await insertRow({ idempotencyKey: key, status: 'IN_PROGRESS' });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - IN_PROGRESS_RECLAIM_MS - 60_000) })
      .where(eq(idempotencyKeys.id, stuck.id));

    await service.reclaimStuckInProgress();

    // Same (userId, route, idempotencyKey) triple as the reclaimed row - would violate the
    // unique index if the old row were still there.
    const [fresh] = await db
      .insert(idempotencyKeys)
      .values({ userId, route: 'RidesController#cleanupTest', idempotencyKey: key, status: 'IN_PROGRESS' })
      .returning();
    expect(fresh).toBeDefined();
  });

  it('sweep runs both sweeps together in one call', async () => {
    const staleCompleted = await insertRow({
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - COMPLETED_RETENTION_MS - 60_000),
    });
    const stuckInProgress = await insertRow({ status: 'IN_PROGRESS' });
    await db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - IN_PROGRESS_RECLAIM_MS - 60_000) })
      .where(eq(idempotencyKeys.id, stuckInProgress.id));

    await service.sweep();

    const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
    expect(rows.map((r) => r.id)).not.toContain(staleCompleted.id);
    expect(rows.map((r) => r.id)).not.toContain(stuckInProgress.id);
  });
});
