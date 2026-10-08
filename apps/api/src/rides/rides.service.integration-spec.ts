import 'dotenv/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
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
  // Metrics stand-in - this suite is about ride lifecycle/authorization, not metrics.
  const metricsStub = {
    rideRequestsTotal: { inc: jest.fn() },
    rideCompletedTotal: { inc: jest.fn() },
    rideCancelledTotal: { inc: jest.fn() },
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new RidesService(db as any, new OutboxService(), fakeEmitter, metricsStub as any);

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
    metricsStub.rideRequestsTotal.inc.mockClear();
    metricsStub.rideCompletedTotal.inc.mockClear();
    metricsStub.rideCancelledTotal.inc.mockClear();
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

    // ride_requests_total (architecture.md §10) incremented exactly once for this successful create.
    expect(metricsStub.rideRequestsTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('cancel() succeeds from a cancellable state (SEARCHING_DRIVER)', async () => {
    const ride = await service.create(riderId, createDto);

    const cancelled = await service.cancel(ride.id, { userId: riderId, role: 'USER' }, 'changed my mind');
    expect(cancelled.status).toBe('CANCELLED_BY_USER');
    expect(cancelled.cancelledAt).not.toBeNull();

    const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id));
    expect(events.some((e) => e.eventType === 'RideCancelled')).toBe(true);

    // ride_cancelled_total labeled by who cancelled - a USER-initiated cancel here.
    expect(metricsStub.rideCancelledTotal.inc).toHaveBeenCalledWith({ cancelled_by: 'USER' });
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

  it('create() rejects a second ride for a user with an existing non-terminal ride (docs/open-items.md #28)', async () => {
    const first = await service.create(riderId, createDto);
    expect(first.status).toBe('SEARCHING_DRIVER');

    await expect(service.create(riderId, createDto)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(riderId, createDto)).rejects.toMatchObject({
      response: { code: 'ACTIVE_RIDE_ALREADY_EXISTS', rideId: first.id },
    });

    const rideRows = await db.select().from(rides).where(eq(rides.userId, riderId));
    expect(rideRows).toHaveLength(1);
  });

  it('create() allows a new ride once the user\'s previous ride reaches a terminal status', async () => {
    const first = await service.create(riderId, createDto);
    await service.cancel(first.id, { userId: riderId, role: 'USER' });

    const second = await service.create(riderId, createDto);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('SEARCHING_DRIVER');
  });

  it('create() rejects a second ride even when the first is still mid-dispatch (DRIVER_ASSIGNED, not just SEARCHING_DRIVER)', async () => {
    const first = await service.create(riderId, createDto);
    await db.update(rides).set({ status: 'DRIVER_ASSIGNED' }).where(eq(rides.id, first.id));

    await expect(service.create(riderId, createDto)).rejects.toBeInstanceOf(ConflictException);

    const rideRows = await db.select().from(rides).where(eq(rides.userId, riderId));
    expect(rideRows).toHaveLength(1);
  });

  it('create() does not reject based on a DIFFERENT user\'s active ride', async () => {
    const otherActive = await service.create(otherUserId, createDto);

    const mine = await service.create(riderId, createDto);
    expect(mine.status).toBe('SEARCHING_DRIVER');

    // Cleanup: this test seeds a ride for otherUserId, which the shared afterEach/afterAll only
    // clean up for riderId - clean it up here directly.
    await service.cancel(otherActive.id, { userId: otherUserId, role: 'USER' });
    await db.delete(rideEvents).where(eq(rideEvents.rideId, otherActive.id));
    await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, otherActive.id));
    await db.delete(rides).where(eq(rides.id, otherActive.id));
  });

  it('findHistoryForUser() returns only that user\'s rides, newest first', async () => {
    const first = await service.create(riderId, createDto);
    // Must cancel the first before creating a second - docs/open-items.md #28: a user may not
    // have two simultaneously non-terminal rides. History still returns every ride regardless
    // of status, so a cancelled ride proves the "all of this user's rides" guarantee just as
    // well as two simultaneously-active ones would have.
    await service.cancel(first.id, { userId: riderId, role: 'USER' });
    const second = await service.create(riderId, createDto);

    const history = await service.findHistoryForUser(riderId);
    const ids = history.map((r) => r.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });
});
