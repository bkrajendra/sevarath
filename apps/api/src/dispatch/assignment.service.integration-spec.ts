import 'dotenv/config';
import { eq, inArray, like, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { drivers, outboxEvents, rideEvents, rideOffers, rides, users, vehicles, type Ride } from '../db/schema';
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
  // Metrics stand-in - this suite is about the accept/reject concurrency races, not metrics;
  // only rideAssignmentDurationSeconds.observe() is ever touched by AssignmentService#accept.
  // Declared here (not just inside beforeAll) so individual tests can assert against it too.
  const metricsStub = { rideAssignmentDurationSeconds: { observe: jest.fn() } };

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

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const outboxService = new OutboxService();
    const driverMatcher = new DriverMatcherService(db as any);
    dispatchService = new DispatchService(db as any, outboxService, driverMatcher, {} as any);
    assignmentService = new AssignmentService(db as any, outboxService, dispatchService, metricsStub as any);

    // Root-cause fix for docs/open-items.md #17/#18: if a PREVIOUS run of this file was
    // interrupted (SIGKILL/timeout/OOM) between seeding its fixtures and its own afterEach, the
    // seeded rows never get deleted and persist in the shared local Postgres indefinitely. They
    // stay AVAILABLE/ACTIVE with a frozen `location_updated_at`, so DriverMatcherService#
    // findCandidates (whose staleness check is a wall-clock window, not tied to this suite's
    // lifetime) keeps treating them as live candidates for up to LOCATION_STALENESS_WINDOW_MS
    // after the crash. Because every test in this file always seeds at the exact same nominal
    // offsets (0.01 / 0.05 degrees from `pickup`), such an orphan can land at the *exact same
    // coordinates* as this run's own fixture, and the unscoped distance query's ORDER BY has no
    // explicit tie-break - so on an exact tie, which row sorts first (the orphan or this run's
    // own driver) is not guaranteed, occasionally handing the cascade's next offer to the orphan
    // instead of the fixture the test is asserting on. Sweep away any such leftovers before this
    // file seeds anything of its own, so a run is never affected by a previous one's crash.
    await purgeOrphanedFixtures();
  });

  beforeEach(() => {
    fakeQueue = { add: jest.fn().mockResolvedValue(undefined) };
    // Re-point dispatchService's queue at this test's fake queue each time (dispatchService is
    // shared across tests; the queue is the only per-test-sensitive dependency it holds).
    (dispatchService as any).timeoutQueue = fakeQueue;
  });

  afterEach(async () => {
    metricsStub.rideAssignmentDurationSeconds.observe.mockClear();
    if (rideIds.length > 0) {
      // outbox_events was missing from this cleanup before this task (not the cause of #17/#18,
      // but accumulating unboundedly across runs all the same - accept()/reject() both call
      // OutboxService#record keyed by rideId as aggregateId). Clean it up alongside the rest.
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, rideIds));
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
    // Belt-and-suspenders: also sweep after the suite finishes, so a crash on this run doesn't
    // even get the 5-minute staleness grace period before the next run is affected.
    await purgeOrphanedFixtures();
    await pool.end();
  });

  /**
   * Deletes any rows matching this file's own unique naming convention (`assign-%` user mobiles,
   * `ADRV-%` driver codes, `ASSIGN-%` vehicle codes - not used anywhere else in the codebase),
   * regardless of whether this run's own bookkeeping arrays (`userIds`/`vehicleIds`/`rideIds`)
   * know about them. See the comment in `beforeAll` for why this exists.
   */
  async function purgeOrphanedFixtures() {
    const staleUsers = await db.select({ id: users.id }).from(users).where(like(users.mobile, 'assign-%'));
    const staleUserIds = staleUsers.map((u) => u.id);

    const staleDrivers =
      staleUserIds.length > 0
        ? await db
            .select({ id: drivers.id, vehicleId: drivers.currentVehicleId })
            .from(drivers)
            .where(inArray(drivers.userId, staleUserIds))
        : [];
    const staleDriverIds = staleDrivers.map((d) => d.id);

    const rideConditions = [
      staleUserIds.length > 0 ? inArray(rides.userId, staleUserIds) : undefined,
      staleDriverIds.length > 0 ? inArray(rides.driverId, staleDriverIds) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const staleRides = rideConditions.length > 0
      ? await db.select({ id: rides.id }).from(rides).where(or(...rideConditions))
      : [];
    const staleRideIds = staleRides.map((r) => r.id);

    if (staleRideIds.length > 0) {
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, staleRideIds));
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, staleRideIds));
      await db.delete(rideOffers).where(inArray(rideOffers.rideId, staleRideIds));
      await db.delete(rides).where(inArray(rides.id, staleRideIds));
    }
    if (staleDriverIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.id, staleDriverIds));
    }
    if (staleUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, staleUserIds));
    }
    // Vehicles are matched by code directly (not just via a stale driver's currentVehicleId) in
    // case a crash happened between creating the vehicle and linking/seeding its driver.
    await db.delete(vehicles).where(like(vehicles.vehicleCode, 'ASSIGN-%'));
  }

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

    // Jitter defends against the exact-tie scenario described above: even if some *other* stale
    // orphan (from a crash this run's own beforeAll purge couldn't have known about, e.g. one
    // created after that purge ran by a genuinely concurrent process) happens to share this
    // test's nominal offset, a sub-degree random jitter makes an exact coordinate collision
    // (and therefore an unresolved ORDER BY tie) vanishingly unlikely, on top of the purge.
    const jitter = (Math.random() - 0.5) * 1e-4;

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: user.id,
        driverCode: `ADRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicle.id,
        currentLatitude: pickup.latitude + offsetDegrees + jitter,
        currentLongitude: pickup.longitude + jitter,
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

    // ride_assignment_duration_seconds observed exactly once, for the successful accept (the
    // rejected second accept below never reaches that point in the method).
    expect(metricsStub.rideAssignmentDurationSeconds.observe).toHaveBeenCalledTimes(1);
    expect(metricsStub.rideAssignmentDurationSeconds.observe).toHaveBeenCalledWith(expect.any(Number));

    await expect(assignmentService.accept(ride.id, driverC.id)).rejects.toMatchObject({
      response: { code: 'RIDE_ALREADY_ASSIGNED' },
    });

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(current.status).toBe('DRIVER_ASSIGNED');
    expect(current.driverId).toBe(driverA.id);

    // Still exactly one observation - the rejected second accept did not add another.
    expect(metricsStub.rideAssignmentDurationSeconds.observe).toHaveBeenCalledTimes(1);
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

  it('cascades through three candidates: two rejections in a row reach the third/farthest driver', async () => {
    const rider = await seedRidingUser();
    const ride = await seedSearchingRide(rider.id);
    const { driver: first } = await seedDriver('cascade-1st', 0.01);
    const { driver: second } = await seedDriver('cascade-2nd', 0.05);
    const { driver: third } = await seedDriver('cascade-3rd', 0.1);
    await seedPendingOffer(ride.id, first.id);

    // Reject #1: nearest -> next-nearest should be offered.
    await assignmentService.reject(ride.id, first.id);

    let offers = await db.select().from(rideOffers).where(eq(rideOffers.rideId, ride.id));
    expect(offers.find((o) => o.driverId === first.id)?.result).toBe('REJECTED');
    const offerToSecond = offers.find((o) => o.driverId === second.id);
    expect(offerToSecond).toBeDefined();
    expect(offerToSecond?.result).toBe('PENDING');
    expect(offers.find((o) => o.driverId === third.id)).toBeUndefined();

    const [rideAfterFirstReject] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(rideAfterFirstReject.status).toBe('SEARCHING_DRIVER');

    // Reject #2: second (now offered) rejects -> third/farthest should finally be offered.
    await assignmentService.reject(ride.id, second.id);

    offers = await db.select().from(rideOffers).where(eq(rideOffers.rideId, ride.id));
    expect(offers.find((o) => o.driverId === first.id)?.result).toBe('REJECTED');
    expect(offers.find((o) => o.driverId === second.id)?.result).toBe('REJECTED');
    const offerToThird = offers.find((o) => o.driverId === third.id);
    expect(offerToThird).toBeDefined();
    expect(offerToThird?.result).toBe('PENDING');

    const [rideAfterSecondReject] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(rideAfterSecondReject.status).toBe('SEARCHING_DRIVER');

    expect(fakeQueue.add).toHaveBeenCalledTimes(2);
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
