import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import type { AddressInfo } from 'net';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { RIDE_SYNC_EVENT, type RideSyncPayload } from '../src/locations/location.gateway';
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
 * Real end-to-end proof of Phase 5's last step - connection-time ride sync on reconnect
 * (docs/plan.md Phase 5, docs/open-items.md's "Real-Time Location" reconnection task), covering
 * exactly the scenario specification.md §8 ("Network disconnect (driver): keep local UI state,
 * sync on reconnect") and §11.2 ("WebSocket server restarts: clients reconnect, state
 * synchronized using REST") describe for a rider:
 *
 *   rider connects (idle, no RideSync) -> ride created & matched to DRIVER_ASSIGNED -> rider's
 *   socket disconnects -> the ride keeps progressing purely over REST while nobody is listening
 *   on the WebSocket side (arrived -> start) -> rider reconnects on a fresh socket and gets a
 *   RideSync reflecting the caught-up RIDE_STARTED state, not the stale DRIVER_ASSIGNED it last
 *   saw -> and, independently, a plain GET /rides/:id (no WebSocket at all) agrees.
 *
 * This is the proof that a client which missed every event in between is still able to recover
 * correct state - not just that the gateway runs without crashing - and that REST alone (not the
 * sync push) is what §11.2 actually guarantees; RIDE_SYNC_EVENT is a convenience on top, never a
 * replacement.
 *
 * A separate, smaller test below covers the driver-side branch of the same connection-time sync
 * logic (reusing LocationGateway's existing findActiveRideForDriver).
 *
 * Own isolated pickup coordinate island, (35.0, 35.0) - distinct from every other dispatch-
 * touching suite's own fixtures ((1.0,1.0) assignment.service, (24.9,72.7) driver-matcher/rides,
 * (50.0,50.0) booking-lifecycle, (65.0,65.0) driver-location, (80.0,80.0) realtime-ride-events) -
 * per the docs/open-items.md #12/#18/#25/#26 precedent, so no other suite's seeded driver can
 * ever outrank this suite's own "nearest" fixture.
 */
describe('Connection-time ride sync on reconnect (e2e, real Postgres + Redis + WebSocket, real dispatch)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let baseUrl: string;

  let riderId: string;
  let riderToken: string;
  let driverUserId: string;
  let driverId: string;
  let vehicleId: string;
  let driverToken: string;

  const openSockets: ClientSocket[] = [];

  const pickup = { latitude: 35.0, longitude: 35.0 };
  const destination = { latitude: 35.01, longitude: 35.01 };

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
      .values({ name: 'LocSync E2E Rider', mobile: `locsync-e2e-rider-${suffix}`, role: 'USER' })
      .returning();
    riderId = rider.id;
    riderToken = jwt.sign({ sub: riderId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [driverUser] = await db
      .insert(users)
      .values({ name: 'LocSync E2E Driver', mobile: `locsync-e2e-driver-${suffix}`, role: 'DRIVER' })
      .returning();
    driverUserId = driverUser.id;
    driverToken = jwt.sign({ sub: driverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `LOCSYNC-E2E-${suffix}`, status: 'AVAILABLE' })
      .returning();
    vehicleId = vehicle.id;

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: driverUserId,
        driverCode: `LOCSYNC-E2E-DRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicleId,
        // Close to the ride's intended pickup so the real Haversine matcher picks this driver.
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
    // A real listening HTTP server is needed - socket.io-client opens an actual socket, same
    // reasoning as test/location-gateway.e2e-spec.ts/test/realtime-ride-events.e2e-spec.ts.
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    for (const socket of openSockets) {
      socket.removeAllListeners();
      socket.close();
    }
    openSockets.length = 0;
  });

  /** Same fire-and-forget-listener timing caveat as booking-lifecycle.e2e-spec.ts - retry absorbs it. */
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

  function connect(token: string): ClientSocket {
    const socket = io(`${baseUrl}/ws`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    openSockets.push(socket);
    return socket;
  }

  function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
      socket.once(event, (value: T) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  /** Resolves `true` if `event` arrives within `windowMs`, `false` if the window elapses first. */
  function didArriveWithin(socket: ClientSocket, event: string, windowMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), windowMs);
      socket.once(event, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Polls `fn` every `intervalMs` until it returns a truthy value or `timeoutMs` elapses. */
  async function pollUntil<T>(
    fn: () => Promise<T | null | undefined>,
    { timeoutMs = 15000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {},
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

  it(
    'proves the full disconnect -> REST-only progress -> reconnect -> caught-up RideSync + REST cycle',
    async () => {
      // Step 1: rider connects with no active ride yet - must receive no RideSync at all.
      const firstSocket = connect(riderToken);
      await waitFor(firstSocket, 'connect');
      const gotUnexpectedSync = await didArriveWithin(firstSocket, RIDE_SYNC_EVENT, 800);
      expect(gotUnexpectedSync).toBe(false);

      // Step 2: rider creates a ride via the real HTTP API; the real dispatch cascade matches
      // and offers it to the seeded nearby driver, who accepts - driving the ride to
      // DRIVER_ASSIGNED, exactly like booking-lifecycle.e2e-spec.ts/realtime-ride-events.e2e-spec.ts.
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

      // Dispatch's 'ride.requested' listener is fire-and-forget (docs/open-items.md #9) - poll
      // for the offer instead of asserting immediately.
      await pollUntil(async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/dispatch/offers/me')
          .set('Authorization', `Bearer ${driverToken}`)
          .expect(200);
        return res.body && res.body.rideId === rideId ? res.body : null;
      });

      const acceptRes = await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
      expect(acceptRes.body.status).toBe('DRIVER_ASSIGNED');

      // Step 3: the rider's WebSocket disconnects - the exact "network disconnect" scenario
      // specification.md §8 names.
      firstSocket.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Step 4: while disconnected, the ride keeps progressing purely over REST - nobody is
      // listening on the WebSocket side at all. This is the proof that correctness never
      // depended on that socket being open.
      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/arrived`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);

      const startRes = await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/start`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
      expect(startRes.body.status).toBe('RIDE_STARTED');

      // Step 5: the rider reconnects on a fresh socket (same JWT) and must receive a RideSync
      // reflecting the current, caught-up state - RIDE_STARTED, not the stale DRIVER_ASSIGNED
      // this client last knew about.
      const secondSocket = connect(riderToken);
      const sync = await waitFor<RideSyncPayload>(secondSocket, RIDE_SYNC_EVENT, 5000);
      expect(sync.rideId).toBe(rideId);
      expect(sync.status).toBe('RIDE_STARTED');
      expect(sync.driverId).toBe(driverId);
      expect(sync.vehicleId).toBe(vehicleId);
      expect(sync.pickupLatitude).toBe(pickup.latitude);
      expect(sync.destinationLatitude).toBe(destination.latitude);

      // Step 6: independent of the sync push, a plain REST read (no WebSocket involved at all)
      // must agree - this is the actual §11.2 "REST alone is sufficient" guarantee; the sync
      // push above is a convenience on top of it, not a replacement for it.
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/rides/${rideId}`)
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200);
      expect(getRes.body.status).toBe('RIDE_STARTED');

      // Clean up this ride's terminal state so afterAll's cleanup has one less row racing
      // dispatch's own fire-and-forget listeners.
      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/complete`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
    },
    30000,
  );

  it(
    'sends a driver a RideSync for its own active ride on connect',
    async () => {
      // A second, independent ride/driver pair so this test does not depend on - or race - the
      // lifecycle the first test drives through the same rider/driver fixtures.
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const [secondRider] = await db
        .insert(users)
        .values({ name: 'LocSync E2E Rider 2', mobile: `locsync-e2e-rider2-${suffix}`, role: 'USER' })
        .returning();
      const [secondVehicle] = await db
        .insert(vehicles)
        .values({ vehicleCode: `LOCSYNC-E2E-2-${suffix}`, status: 'IN_SERVICE' })
        .returning();
      const [secondDriverUser] = await db
        .insert(users)
        .values({ name: 'LocSync E2E Driver 2', mobile: `locsync-e2e-driver2-${suffix}`, role: 'DRIVER' })
        .returning();
      const secondDriverToken = jwt.sign(
        { sub: secondDriverUser.id, role: 'DRIVER' },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: '15m' },
      );
      const [secondDriver] = await db
        .insert(drivers)
        .values({
          userId: secondDriverUser.id,
          driverCode: `LOCSYNC-E2E-DRV-2-${suffix}`,
          status: 'ACTIVE',
          availability: 'BUSY',
          currentVehicleId: secondVehicle.id,
        })
        .returning();
      // Seeded directly already at DRIVER_ASSIGNED - this test only cares about the connection-
      // time sync logic reading an already-active ride, not about driving it there via dispatch.
      const [secondRide] = await db
        .insert(rides)
        .values({
          userId: secondRider.id,
          driverId: secondDriver.id,
          vehicleId: secondVehicle.id,
          pickupLatitude: pickup.latitude,
          pickupLongitude: pickup.longitude,
          destinationLatitude: destination.latitude,
          destinationLongitude: destination.longitude,
          status: 'DRIVER_ASSIGNED',
        })
        .returning();

      try {
        const driverSocket = connect(secondDriverToken);
        const sync = await waitFor<RideSyncPayload>(driverSocket, RIDE_SYNC_EVENT, 5000);
        expect(sync.rideId).toBe(secondRide.id);
        expect(sync.status).toBe('DRIVER_ASSIGNED');
        expect(sync.driverId).toBe(secondDriver.id);
        expect(sync.vehicleId).toBe(secondVehicle.id);
      } finally {
        await db.delete(rides).where(eq(rides.id, secondRide.id));
        await db.delete(drivers).where(eq(drivers.id, secondDriver.id));
        await db.delete(vehicles).where(eq(vehicles.id, secondVehicle.id));
        await db.delete(users).where(inArray(users.id, [secondRider.id, secondDriverUser.id]));
      }
    },
    10000,
  );
});
