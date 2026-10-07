import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import * as schema from '../src/db/schema';
import {
  drivers,
  outboxEvents,
  rideEvents,
  rideOffers,
  rides,
  users,
  vehicles,
} from '../src/db/schema';

/**
 * Phase 4 ("Booking & Dispatch") end-to-end lifecycle proof: a real user requests a ride, the
 * real (non-mocked) dispatch cascade matches and offers it to a real nearby driver via the real
 * Haversine-based DriverMatcherService, that driver accepts and drives the ride through
 * arrived/start/complete, and it shows up in the rider's history - all through the real public
 * HTTP API against the real local Postgres/Redis, with nothing mocked. Unlike
 * test/idempotency.e2e-spec.ts, DriverMatcherService is deliberately left real: proving the
 * actual matching path (and the handoff between RidesService's 'ride.requested' emit and
 * DispatchService's listener - see docs/open-items.md #9) is the point of this test.
 *
 * There is no WebSocket gateway yet (Phase 5 - docs/open-items.md), so the driver's only way to
 * discover a new offer is polling GET /api/v1/dispatch/offers/me, which is what this test does
 * too, matching how a real driver app would behave today.
 *
 * Pickup/destination deliberately sit at a coordinate (50.0, 50.0-ish) far from every other
 * suite's own fixtures (assignment.service.integration-spec.ts's (1.0, 1.0),
 * driver-matcher.service.integration-spec.ts's/rides.service.integration-spec.ts's (24.9, 72.7))
 * - this is the one suite in the repo that exercises the real, unscoped, distance-ordered
 * findCandidates() query through a real HTTP boot, so (per the isolation technique
 * docs/open-items.md #12/#17/#18 already established across other dispatch suites) it needs its
 * own far-apart coordinate island too, so no other suite's seeded driver can ever outrank this
 * one's real driver fixture.
 */
describe('Booking lifecycle (e2e, real Postgres + Redis, real dispatch)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let riderId: string;
  let riderToken: string;
  let driverUserId: string;
  let driverId: string;
  let vehicleId: string;
  let driverToken: string;

  const pickup = { latitude: 50.0, longitude: 50.0 };
  const destination = { latitude: 50.01, longitude: 50.01 };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [rider] = await db
      .insert(users)
      .values({ name: 'Booking E2E Rider', mobile: `booking-e2e-rider-${suffix}`, role: 'USER' })
      .returning();
    riderId = rider.id;
    riderToken = jwt.sign({ sub: riderId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [driverUser] = await db
      .insert(users)
      .values({ name: 'Booking E2E Driver', mobile: `booking-e2e-driver-${suffix}`, role: 'DRIVER' })
      .returning();
    driverUserId = driverUser.id;
    driverToken = jwt.sign({ sub: driverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `BOOKING-E2E-${suffix}`, status: 'AVAILABLE' })
      .returning();
    vehicleId = vehicle.id;

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: driverUserId,
        driverCode: `BOOKING-E2E-DRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicleId,
        // Close to the ride's intended pickup point so the real Haversine matcher picks this
        // driver (not a PostGIS/geofence filter - see docs/open-items.md #1/#2/#10).
        currentLatitude: pickup.latitude + 0.001,
        currentLongitude: pickup.longitude,
        locationUpdatedAt: new Date(),
      })
      .returning();
    driverId = driver.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  /**
   * Same fire-and-forget-child-row timing caveat test/idempotency.e2e-spec.ts documents: both
   * RidesService#create's 'ride.requested' emit and RidesService#complete's 'ride.completed'
   * emit are handled by DispatchModule listeners that are NOT awaited by the HTTP response (see
   * docs/open-items.md #9 and the comment in dispatch.service.ts), so a row this test expects to
   * exist (an offer) or a cleanup this test attempts (deleting a ride those listeners may still
   * be touching) can race briefly. Retrying absorbs it instead of flaking.
   */
  async function cleanupRidesForRider(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rideRows = await db.select({ id: rides.id }).from(rides).where(eq(rides.userId, riderId));
      const rideIds = rideRows.map((r) => r.id);
      if (rideIds.length === 0) {
        return;
      }
      await db.delete(rideOffers).where(inArray(rideOffers.rideId, rideIds));
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, rideIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, rideIds));
      try {
        await db.delete(rides).where(inArray(rides.id, rideIds));
        return;
      } catch (error) {
        if (attempt === 4) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  afterAll(async () => {
    await cleanupRidesForRider();
    if (driverId) {
      await db.delete(drivers).where(eq(drivers.id, driverId));
    }
    if (vehicleId) {
      await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
    }
    const userIdsToDelete = [riderId, driverUserId].filter(Boolean);
    if (userIdsToDelete.length > 0) {
      await db.delete(users).where(inArray(users.id, userIdsToDelete));
    }
    await app.close();
    await pool.end();
  });

  /** Polls `fn` every `intervalMs` until it returns a truthy value or `timeoutMs` elapses. */
  async function pollUntil<T>(
    fn: () => Promise<T | null | undefined>,
    { timeoutMs = 3000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await fn();
      if (result) {
        return result;
      }
      if (Date.now() >= deadline) {
        throw new Error(`pollUntil: condition never became truthy within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  it('takes a ride all the way from request through the real dispatch cascade to completion and history', async () => {
    // Step 2: rider requests a ride through the real public API.
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
      })
      .expect(201);

    const rideId = createRes.body.id;
    expect(createRes.body.status).toBe('SEARCHING_DRIVER');
    expect(createRes.body.userId).toBe(riderId);

    // Step 3: RidesService#create's 'ride.requested' emit is fire-and-forget (open-items.md
    // #9) - the real DispatchService listener runs the real DriverMatcherService query and
    // creates the ride_offers row asynchronously, so poll for it instead of asserting
    // immediately.
    const offer = await pollUntil(async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dispatch/offers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
      return res.body && res.body.rideId === rideId ? res.body : null;
    });
    expect(offer.rideId).toBe(rideId);

    // Step 4: driver accepts through the real public API.
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(acceptRes.body.status).toBe('DRIVER_ASSIGNED');
    expect(acceptRes.body.driverId).toBe(driverId);

    // Step 5: arrived -> start -> complete, each as the driver, matching
    // ride-state-machine.ts's declared transitions.
    const arrivedRes = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(arrivedRes.body.status).toBe('DRIVER_ARRIVED');

    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(startRes.body.status).toBe('RIDE_STARTED');

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/complete`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(completeRes.body.status).toBe('COMPLETED');

    // Step 6: the completed ride shows up in the rider's own history via the real API.
    const historyRes = await request(app.getHttpServer())
      .get('/api/v1/rides/history')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);
    const historyRide = (historyRes.body as Array<{ id: string; status: string }>).find(
      (r) => r.id === rideId,
    );
    expect(historyRide).toBeDefined();
    expect(historyRide?.status).toBe('COMPLETED');

    // Step 7: direct DB read (not the API) proving RidesService#complete's 'ride.completed'
    // emit was actually consumed by DispatchService's @OnEvent('ride.completed') release
    // listener - also fire-and-forget (same caveat as step 3), so poll briefly.
    await pollUntil(async () => {
      const [finalDriver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
      const [finalVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      return finalDriver.availability === 'AVAILABLE' && finalVehicle.status === 'AVAILABLE'
        ? true
        : null;
    });

    const [finalDriver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
    const [finalVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(finalDriver.availability).toBe('AVAILABLE');
    expect(finalVehicle.status).toBe('AVAILABLE');
  });
});
