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
 * Real end-to-end proof of the full Phase 5 real-time chain (docs/open-items.md #3/#22):
 *
 *   outbox_events insert (rides/dispatch transaction)
 *     -> OutboxPublisherService's ~2s poll
 *     -> BullMQ `domain-events` queue
 *     -> DomainEventRealtimeConsumer
 *     -> LocationGateway.emitToUser / emitToDriver
 *     -> the rider's / driver's real, live WebSocket connection
 *
 * A rider and a driver each connect a real socket.io client first, then the test drives one ride
 * through the real HTTP API (create -> the real dispatch cascade offers a real nearby driver ->
 * accept -> arrived -> start -> complete), asserting at each step that the right WebSocket
 * event reaches the right room and nobody else - nothing about the gateway, the consumer, the
 * outbox publisher, or dispatch is mocked.
 *
 * Own isolated pickup coordinate island (per the established pattern - docs/open-items.md
 * #12/#18, mirrored by booking-lifecycle.e2e-spec.ts's own comment): (80.0, 80.0), far from
 * every other dispatch-touching suite's own fixtures, so no other suite's seeded driver can
 * ever outrank this suite's.
 */
describe('Real-time ride events (e2e, real Postgres + Redis + WebSocket, real dispatch)', () => {
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

  const pickup = { latitude: 80.0, longitude: 80.0 };
  const destination = { latitude: 80.01, longitude: 80.01 };

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
      .values({ name: 'Realtime E2E Rider', mobile: `realtime-e2e-rider-${suffix}`, role: 'USER' })
      .returning();
    riderId = rider.id;
    riderToken = jwt.sign({ sub: riderId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [driverUser] = await db
      .insert(users)
      .values({ name: 'Realtime E2E Driver', mobile: `realtime-e2e-driver-${suffix}`, role: 'DRIVER' })
      .returning();
    driverUserId = driverUser.id;
    driverToken = jwt.sign({ sub: driverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `REALTIME-E2E-${suffix}`, status: 'AVAILABLE' })
      .returning();
    vehicleId = vehicle.id;

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: driverUserId,
        driverCode: `REALTIME-E2E-DRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicleId,
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
    // A real listening HTTP server is needed - socket.io-client opens an actual socket, unlike
    // supertest's in-memory HTTP usage for the REST half of this same test (same reasoning as
    // test/location-gateway.e2e-spec.ts).
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
    'carries one ride from request through completion, delivering each real-time event to exactly the right room(s)',
    async () => {
      // Both sockets connect BEFORE the ride even exists, like real rider/driver apps opening
      // their connection on launch - proves delivery doesn't depend on connect timing.
      const riderSocket = connect(riderToken);
      const driverSocket = connect(driverToken);
      await Promise.all([waitFor(riderSocket, 'connect'), waitFor(driverSocket, 'connect')]);

      // RideDriverNotified: only the offered driver's room, never the rider's - OutboxPublisherService
      // polls every ~2s, so give this (and every later wait below) a generous timeout covering
      // several poll cycles plus the dispatch cascade's own async work.
      const riderGotNotified = waitFor(riderSocket, 'RideDriverNotified', 15000);
      const driverNotified = waitFor<{ rideId: string; driverId: string; status: string }>(
        driverSocket,
        'RideDriverNotified',
        15000,
      );

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

      const notified = await driverNotified;
      expect(notified.rideId).toBe(rideId);
      expect(notified.driverId).toBe(driverId);
      expect(notified.status).toBe('SEARCHING_DRIVER');

      // Nobody else's room got it - specifically not the rider's.
      await expect(
        Promise.race([riderGotNotified, new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))]),
      ).resolves.toBe('timeout');

      // RideAssigned: both the rider and the now-assigned driver.
      const riderAssigned = waitFor<{ rideId: string; driverId: string; vehicleId: string; status: string }>(
        riderSocket,
        'RideAssigned',
        15000,
      );
      const driverAssigned = waitFor<{ rideId: string; driverId: string; status: string }>(
        driverSocket,
        'RideAssigned',
        15000,
      );

      const acceptRes = await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
      expect(acceptRes.body.status).toBe('DRIVER_ASSIGNED');
      expect(acceptRes.body.driverId).toBe(driverId);

      const [riderAssignedEvt, driverAssignedEvt] = await Promise.all([riderAssigned, driverAssigned]);
      expect(riderAssignedEvt.rideId).toBe(rideId);
      expect(riderAssignedEvt.driverId).toBe(driverId);
      expect(riderAssignedEvt.vehicleId).toBe(vehicleId);
      expect(riderAssignedEvt.status).toBe('DRIVER_ASSIGNED');
      expect(driverAssignedEvt.rideId).toBe(rideId);

      // DriverArrived: the rider only, never the driver (they tapped the button themselves).
      const riderArrived = waitFor<{ rideId: string; status: string }>(riderSocket, 'DriverArrived', 15000);
      const driverGotArrived = waitFor(driverSocket, 'DriverArrived', 15000);

      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/arrived`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);

      const arrivedEvt = await riderArrived;
      expect(arrivedEvt.rideId).toBe(rideId);
      expect(arrivedEvt.status).toBe('DRIVER_ARRIVED');
      await expect(
        Promise.race([driverGotArrived, new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))]),
      ).resolves.toBe('timeout');

      // RideStarted / RideCompleted: the rider only.
      const riderStarted = waitFor<{ rideId: string; status: string }>(riderSocket, 'RideStarted', 15000);
      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/start`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
      expect((await riderStarted).rideId).toBe(rideId);

      const riderCompleted = waitFor<{ rideId: string; status: string }>(riderSocket, 'RideCompleted', 15000);
      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/complete`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);
      const completedEvt = await riderCompleted;
      expect(completedEvt.rideId).toBe(rideId);
      expect(completedEvt.status).toBe('COMPLETED');
    },
    30000,
  );
});
