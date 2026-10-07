import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { rides, users } from '../db/schema';
import { applyRideTransition, RideTransitionConflictException } from './ride-state-machine';

describe('applyRideTransition (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let testUserId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const [user] = await db
      .insert(users)
      .values({
        name: 'State Machine Test User',
        mobile: `sm-test-${Date.now()}`,
      })
      .returning();
    testUserId = user.id;
  });

  afterAll(async () => {
    await db.delete(rides).where(eq(rides.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await pool.end();
  });

  async function insertRide() {
    const [ride] = await db
      .insert(rides)
      .values({
        userId: testUserId,
        pickupLatitude: 24.9,
        pickupLongitude: 72.7,
        destinationLatitude: 24.91,
        destinationLongitude: 72.71,
        status: 'REQUESTED',
      })
      .returning();
    return ride;
  }

  afterEach(async () => {
    await db.delete(rides).where(eq(rides.userId, testUserId));
  });

  it('applies a valid transition and stamps the right timestamp column', async () => {
    const ride = await insertRide();

    const updated = await applyRideTransition(db, ride.id, ['REQUESTED'], 'SEARCHING_DRIVER');
    expect(updated.status).toBe('SEARCHING_DRIVER');

    const assigned = await applyRideTransition(db, ride.id, ['SEARCHING_DRIVER'], 'DRIVER_ASSIGNED');
    expect(assigned.status).toBe('DRIVER_ASSIGNED');
    expect(assigned.acceptedAt).not.toBeNull();
    expect(assigned.driverArrivedAt).toBeNull();
    expect(assigned.updatedAt.getTime()).toBeGreaterThanOrEqual(ride.updatedAt.getTime());
  });

  it('throws RideTransitionConflictException and leaves state untouched when fromStatuses no longer match', async () => {
    const ride = await insertRide();

    await applyRideTransition(db, ride.id, ['REQUESTED'], 'SEARCHING_DRIVER');

    await expect(
      applyRideTransition(db, ride.id, ['REQUESTED'], 'SEARCHING_DRIVER'),
    ).rejects.toThrow(RideTransitionConflictException);

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('SEARCHING_DRIVER');
  });

  it('simulates two concurrent callers racing on the same fromStatuses: exactly one wins', async () => {
    const ride = await insertRide();
    await applyRideTransition(db, ride.id, ['REQUESTED'], 'SEARCHING_DRIVER');

    const attempt = () => applyRideTransition(db, ride.id, ['SEARCHING_DRIVER'], 'DRIVER_ASSIGNED');

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RideTransitionConflictException);

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('DRIVER_ASSIGNED');
  });

  it('allows overriding the conflict exception code', async () => {
    const ride = await insertRide();
    await applyRideTransition(db, ride.id, ['REQUESTED'], 'SEARCHING_DRIVER');
    await applyRideTransition(db, ride.id, ['SEARCHING_DRIVER'], 'DRIVER_ASSIGNED');

    await expect(
      applyRideTransition(
        db,
        ride.id,
        ['SEARCHING_DRIVER'],
        'DRIVER_ASSIGNED',
        {},
        'RIDE_ALREADY_ASSIGNED',
      ),
    ).rejects.toMatchObject({
      response: { code: 'RIDE_ALREADY_ASSIGNED' },
    });
  });
});
