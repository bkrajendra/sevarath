import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { outboxEvents, rideEvents, rides, users } from '../db/schema';
import { OutboxService } from '../events/outbox/outbox.service';
import { RidesService } from './rides.service';

describe('RidesService (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: RidesService;
  let riderId: string;
  let otherUserId: string;

  const fakeEmitter = { emit: jest.fn() } as unknown as import('@nestjs/event-emitter').EventEmitter2;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new RidesService(db as any, new OutboxService(), fakeEmitter);

    const [rider] = await db
      .insert(users)
      .values({ name: 'Rider Test', mobile: `rider-test-${Date.now()}` })
      .returning();
    riderId = rider.id;

    const [other] = await db
      .insert(users)
      .values({ name: 'Other Test User', mobile: `other-test-${Date.now()}` })
      .returning();
    otherUserId = other.id;
  });

  afterAll(async () => {
    const rideRows = await db.select({ id: rides.id }).from(rides).where(eq(rides.userId, riderId));
    const rideIds = rideRows.map((r) => r.id);
    if (rideIds.length > 0) {
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, rideIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, rideIds));
      await db.delete(rides).where(inArray(rides.id, rideIds));
    }
    await db.delete(users).where(eq(users.id, riderId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  afterEach(async () => {
    const rideRows = await db.select({ id: rides.id }).from(rides).where(eq(rides.userId, riderId));
    const rideIds = rideRows.map((r) => r.id);
    if (rideIds.length > 0) {
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, rideIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, rideIds));
      await db.delete(rides).where(inArray(rides.id, rideIds));
    }
  });

  const createDto = {
    pickupLatitude: 24.9,
    pickupLongitude: 72.7,
    destinationLatitude: 24.91,
    destinationLongitude: 72.71,
  };

  it('create() lands the ride in SEARCHING_DRIVER with both ride_events rows and one outbox row', async () => {
    const ride = await service.create(riderId, createDto);

    expect(ride.status).toBe('SEARCHING_DRIVER');
    expect(ride.userId).toBe(riderId);

    const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.eventType).sort()).toEqual(['RideRequested', 'RideSearchingDriver'].sort());

    const outboxRows = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ride.id));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].eventType).toBe('RideRequested');
    expect(outboxRows[0].aggregateType).toBe('ride');
  });

  it('cancel() succeeds from a cancellable state (SEARCHING_DRIVER)', async () => {
    const ride = await service.create(riderId, createDto);

    const cancelled = await service.cancel(ride.id, { userId: riderId, role: 'USER' }, 'changed my mind');
    expect(cancelled.status).toBe('CANCELLED_BY_USER');
    expect(cancelled.cancelledAt).not.toBeNull();

    const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id));
    expect(events.some((e) => e.eventType === 'RideCancelled')).toBe(true);
  });

  it('cancel() is rejected once the ride has reached RIDE_STARTED', async () => {
    const ride = await service.create(riderId, createDto);

    // Drive the ride forward past the cancellable window directly via SQL (no Dispatch module
    // yet to do this through real driver-accept flow).
    await db.update(rides).set({ status: 'RIDE_STARTED' }).where(eq(rides.id, ride.id));

    await expect(
      service.cancel(ride.id, { userId: riderId, role: 'USER' }),
    ).rejects.toMatchObject({ status: 400 });

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('RIDE_STARTED');
  });

  it('findById() throws ForbiddenException for a user who is not the rider', async () => {
    const ride = await service.create(riderId, createDto);

    await expect(
      service.findById(ride.id, { userId: otherUserId, role: 'USER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findById() succeeds for the riding user', async () => {
    const ride = await service.create(riderId, createDto);

    const found = await service.findById(ride.id, { userId: riderId, role: 'USER' });
    expect(found.id).toBe(ride.id);
  });

  it('cancel() throws ForbiddenException for a user who is not the rider', async () => {
    const ride = await service.create(riderId, createDto);

    await expect(
      service.cancel(ride.id, { userId: otherUserId, role: 'USER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findHistoryForUser() returns only that user\'s rides, newest first', async () => {
    const first = await service.create(riderId, createDto);
    const second = await service.create(riderId, createDto);

    const history = await service.findHistoryForUser(riderId);
    const ids = history.map((r) => r.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });
});
