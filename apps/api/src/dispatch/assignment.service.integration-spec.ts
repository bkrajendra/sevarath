import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { drivers, rideEvents, rideOffers, rides, users, vehicles, type Ride } from '../db/schema';
import { OutboxService } from '../events/outbox/outbox.service';
import { RideTransitionConflictException } from '../rides/ride-state-machine';
import { DriverMatcherService } from './driver-matcher.service';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';

describe('AssignmentService (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let assignmentService: AssignmentService;
  let dispatchService: DispatchService;
  let fakeQueue: { add: jest.Mock };

  // Reset per test (afterEach cleans up and clears these) so leftover AVAILABLE drivers from one
  // test never interfere with another test's nearest-candidate assertions.
  let userIds: string[] = [];
  let vehicleIds: string[] = [];
  let rideIds: string[] = [];

  // Deliberately far from driver-matcher.service.integration-spec.ts's pickup point (24.9,
  // 72.7) and any real-world campus coordinates other tests might use - these integration tests
  // share one real Postgres instance and jest may run test files in parallel workers, so an
  // unrelated suite's seeded drivers must land too far from THIS pickup to ever outrank this
  // suite's own "nearest"/"next nearest" test drivers.
  const pickup = { latitude: 1.0, longitude: 1.0 };
  const destination = { latitude: 1.01, longitude: 1.01 };

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const outboxService = new OutboxService();
    const driverMatcher = new DriverMatcherService(db as any);
    dispatchService = new DispatchService(db as any, outboxService, driverMatcher, {} as any);
    assignmentService = new AssignmentService(db as any, outboxService, dispatchService);
  });

  beforeEach(() => {
    fakeQueue = { add: jest.fn().mockResolvedValue(undefined) };
    // Re-point dispatchService's queue at this test's fake queue each time (dispatchService is
    // shared across tests; the queue is the only per-test-sensitive dependency it holds).
    (dispatchService as any).timeoutQueue = fakeQueue;
  });

  afterEach(async () => {
    if (rideIds.length > 0) {
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, rideIds));
      await db.delete(rideOffers).where(inArray(rideOffers.rideId, rideIds));
      await db.delete(rides).where(inArray(rides.id, rideIds));
    }
    if (userIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    if (vehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, vehicleIds));
    }
    userIds = [];
    vehicleIds = [];
    rideIds = [];
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedDriver(label: string, offsetDegrees = 0.01) {
    const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db
      .insert(users)
      .values({ name: `Assign Test ${label}`, mobile: `assign-${suffix}` })
      .returning();
    userIds.push(user.id);

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `ASSIGN-${suffix}`, status: 'AVAILABLE' })
      .returning();
    vehicleIds.push(vehicle.id);

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: user.id,
        driverCode: `ADRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicle.id,
        currentLatitude: pickup.latitude + offsetDegrees,
        currentLongitude: pickup.longitude,
        locationUpdatedAt: new Date(),
      })
      .returning();
    return { user, vehicle, driver };
  }

  async function seedRidingUser() {
    const [user] = await db
      .insert(users)
      .values({ name: 'Assign Rider', mobile: `assign-rider-${Date.now()}-${Math.random()}` })
      .returning();
    userIds.push(user.id);
    return user;
  }

  async function seedSearchingRide(riderId: string): Promise<Ride> {
    const [ride] = await db
      .insert(rides)
      .values({
        userId: riderId,
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
        status: 'SEARCHING_DRIVER',
      })
      .returning();
    rideIds.push(ride.id);
    return ride;
  }

  async function seedPendingOffer(rideId: string, driverId: string) {
    await db.insert(rideOffers).values({ rideId, driverId, result: 'PENDING' });
  }

  it('races two different drivers accepting the same ride: exactly one wins', async () => {
    const rider = await seedRidingUser();
    const ride = await seedSearchingRide(rider.id);
    const { driver: driverA } = await seedDriver('race-a');
    const { driver: driverB } = await seedDriver('race-b');
    await seedPendingOffer(ride.id, driverA.id);
    await seedPendingOffer(ride.id, driverB.id);

    const results = await Promise.allSettled([
      assignmentService.accept(ride.id, driverA.id),
      assignmentService.accept(ride.id, driverB.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RideTransitionConflictException);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'RIDE_ALREADY_ASSIGNED' },
    });

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('DRIVER_ASSIGNED');
    expect([driverA.id, driverB.id]).toContain(current.driverId);
  });

  it('second accept on an already-assigned ride fails with RIDE_ALREADY_ASSIGNED', async () => {
    const rider = await seedRidingUser();
    const ride = await seedSearchingRide(rider.id);
    const { driver: driverA } = await seedDriver('already-a');
    const { driver: driverC } = await seedDriver('already-c');
    await seedPendingOffer(ride.id, driverA.id);
    await seedPendingOffer(ride.id, driverC.id);

    await assignmentService.accept(ride.id, driverA.id);

    await expect(assignmentService.accept(ride.id, driverC.id)).rejects.toMatchObject({
      response: { code: 'RIDE_ALREADY_ASSIGNED' },
    });

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('DRIVER_ASSIGNED');
    expect(current.driverId).toBe(driverA.id);
  });

  it('races the same driver across two different rides: exactly one wins, the other fails with DRIVER_NOT_AVAILABLE and rolls back', async () => {
    const riderX = await seedRidingUser();
    const riderY = await seedRidingUser();
    const rideX = await seedSearchingRide(riderX.id);
    const rideY = await seedSearchingRide(riderY.id);
    const { driver } = await seedDriver('shared');
    await seedPendingOffer(rideX.id, driver.id);
    await seedPendingOffer(rideY.id, driver.id);

    const results = await Promise.allSettled([
      assignmentService.accept(rideX.id, driver.id),
      assignmentService.accept(rideY.id, driver.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'DRIVER_NOT_AVAILABLE' },
    });

    const [currentX] = await db.select().from(rides).where(eq(rides.id, rideX.id));
    const [currentY] = await db.select().from(rides).where(eq(rides.id, rideY.id));
    const statuses = [currentX.status, currentY.status];
    // Exactly one of the two rides got assigned; the loser rolled all the way back to
    // SEARCHING_DRIVER (not left half-updated), proving the driver-claim conditional update
    // is what enforces this, not the ride transition alone.
    expect(statuses.filter((s) => s === 'DRIVER_ASSIGNED')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'SEARCHING_DRIVER')).toHaveLength(1);

    const [finalDriver] = await db.select().from(drivers).where(eq(drivers.id, driver.id));
    expect(finalDriver.availability).toBe('BUSY');
  });

  it('reject() marks the offer REJECTED and re-offers the next nearest candidate', async () => {
    const rider = await seedRidingUser();
    const ride = await seedSearchingRide(rider.id);
    const { driver: nearest } = await seedDriver('reject-near', 0.01);
    const { driver: nextNearest } = await seedDriver('reject-next', 0.05);
    await seedPendingOffer(ride.id, nearest.id);

    await assignmentService.reject(ride.id, nearest.id);

    const offers = await db.select().from(rideOffers).where(eq(rideOffers.rideId, ride.id));
    const rejectedOffer = offers.find((o) => o.driverId === nearest.id);
    expect(rejectedOffer?.result).toBe('REJECTED');
    expect(rejectedOffer?.respondedAt).not.toBeNull();

    const newOffer = offers.find((o) => o.driverId === nextNearest.id);
    expect(newOffer).toBeDefined();
    expect(newOffer?.result).toBe('PENDING');

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('SEARCHING_DRIVER');

    expect(fakeQueue.add).toHaveBeenCalled();
  });

  it('accept() throws NO_PENDING_OFFER when the driver has no pending offer for this ride', async () => {
    const rider = await seedRidingUser();
    const ride = await seedSearchingRide(rider.id);
    const { driver } = await seedDriver('no-offer');

    await expect(assignmentService.accept(ride.id, driver.id)).rejects.toMatchObject({
      response: { code: 'NO_PENDING_OFFER' },
    });
  });
});
