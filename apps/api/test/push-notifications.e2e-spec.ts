import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as admin from 'firebase-admin';
import { AppModule } from '../src/app.module';
import { FIREBASE_ADMIN } from '../src/auth/firebase/firebase-admin.provider';
import * as schema from '../src/db/schema';
import {
  deviceTokens,
  drivers,
  outboxEvents,
  rideEvents,
  rideOffers,
  rides,
  users,
  vehicles,
} from '../src/db/schema';

/**
 * Real `admin.app.App` is swapped out via `overrideProvider(FIREBASE_ADMIN)` for a fake object,
 * and `firebase-admin`'s `messaging()` is jest-mocked so the test can assert exactly what would
 * have been sent, without a real Firebase project (there is none in this sandbox - see
 * docs/open-items.md). Everything else in this test is real: Postgres, Redis/BullMQ, the real
 * outbox publisher poll, both fan-out queues, and the real dispatch cascade.
 */
jest.mock('firebase-admin', () => ({
  messaging: jest.fn(),
}));

/**
 * Phase 7 ("Notifications") end-to-end proof of the full push pipeline:
 *
 *   outbox_events insert (rides.service.ts#accept, via assignment.service.ts)
 *     -> OutboxPublisherService's ~2s poll, fanned out onto BOTH `domain-events` AND
 *        `notification-events` (docs/open-items.md's fan-out change)
 *     -> PushNotificationConsumer (`notification-events`)
 *     -> device_tokens lookup for the rider
 *     -> admin.messaging().send() (mocked - see above)
 *
 * Drives a real ride through create -> the real dispatch cascade -> accept (the transition
 * that emits `RideAssigned`), with a device token registered for the rider beforehand via the
 * real `POST /api/v1/notifications/device-tokens` endpoint. Own pickup coordinate island
 * (90.0, 90.0), per the established docs/open-items.md #12/#18/#25/#26/#30 isolation pattern.
 */
describe('Push notifications (e2e, real Postgres + Redis + BullMQ, mocked FIREBASE_ADMIN)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sendMock: jest.Mock;

  let riderId: string;
  let riderToken: string;
  let driverUserId: string;
  let driverId: string;
  let vehicleId: string;
  let driverToken: string;
  let deviceTokenId: string | undefined;

  const pickup = { latitude: 85.0, longitude: 85.0 };
  const destination = { latitude: 85.01, longitude: 85.01 };
  const fcmToken = `push-e2e-fcm-token-${Date.now()}`;

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
      .values({ name: 'Push E2E Rider', mobile: `push-e2e-rider-${suffix}`, role: 'USER' })
      .returning();
    riderId = rider.id;
    riderToken = jwt.sign({ sub: riderId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [driverUser] = await db
      .insert(users)
      .values({ name: 'Push E2E Driver', mobile: `push-e2e-driver-${suffix}`, role: 'DRIVER' })
      .returning();
    driverUserId = driverUser.id;
    driverToken = jwt.sign({ sub: driverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `PUSH-E2E-${suffix}`, status: 'AVAILABLE' })
      .returning();
    vehicleId = vehicle.id;

    const [driver] = await db
      .insert(drivers)
      .values({
        userId: driverUserId,
        driverCode: `PUSH-E2E-DRV-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicleId,
        currentLatitude: pickup.latitude + 0.001,
        currentLongitude: pickup.longitude,
        locationUpdatedAt: new Date(),
      })
      .returning();
    driverId = driver.id;

    sendMock = jest.fn().mockResolvedValue('message-id');
    (admin.messaging as unknown as jest.Mock).mockReturnValue({ send: sendMock });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_ADMIN)
      .useValue({ name: 'push-e2e-fake-app' })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

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
    if (deviceTokenId) {
      await db.delete(deviceTokens).where(eq(deviceTokens.id, deviceTokenId));
    }
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
    { timeoutMs = 8000, intervalMs = 150 }: { timeoutMs?: number; intervalMs?: number } = {},
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
    'pushes "Driver on the way" to the rider once the ride is assigned, via the real outbox -> ' +
      'notification-events -> PushNotificationConsumer pipeline',
    async () => {
      // Register the rider's device token through the real public API first.
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ token: fcmToken, platform: 'ANDROID' })
        .expect(201);
      expect(registerRes.body.userId).toBe(riderId);
      expect(registerRes.body.platform).toBe('ANDROID');
      deviceTokenId = registerRes.body.id;

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

      // Real dispatch cascade is async (docs/open-items.md #9) - poll for the offer.
      const offer = await pollUntil(async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/dispatch/offers/me')
          .set('Authorization', `Bearer ${driverToken}`)
          .expect(200);
        return res.body && res.body.rideId === rideId ? res.body : null;
      });
      expect(offer.rideId).toBe(rideId);

      await request(app.getHttpServer())
        .post(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(201);

      // RideAssigned now has to travel outbox -> (both queues) -> PushNotificationConsumer ->
      // device_tokens lookup -> admin.messaging().send() - poll for the mocked send call
      // instead of asserting immediately, same reasoning as every other real-pipeline e2e
      // suite's pollUntil use.
      await pollUntil(() =>
        Promise.resolve(
          sendMock.mock.calls.some(([arg]) => arg?.token === fcmToken && arg?.data?.rideId === rideId)
            ? true
            : null,
        ),
      );

      const call = sendMock.mock.calls.find(([arg]) => arg?.token === fcmToken && arg?.data?.rideId === rideId);
      expect(call?.[0]).toEqual({
        token: fcmToken,
        notification: {
          title: 'Driver on the way',
          body: 'A driver has been assigned to your ride and is heading your way.',
        },
        data: { rideId, eventType: 'RideAssigned' },
      });

      // Negative check: the driver who just accepted never gets a push for their own action -
      // push-recipients.ts's deliberate divergence from the WS routing table.
      expect(sendMock.mock.calls.some(([arg]) => arg?.data?.eventType === 'RideAssigned' && arg?.token !== fcmToken)).toBe(
        false,
      );
    },
    20000,
  );
});
