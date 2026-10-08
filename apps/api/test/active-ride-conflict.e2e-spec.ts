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
import { DispatchService } from '../src/dispatch/dispatch.service';
import * as schema from '../src/db/schema';
import { outboxEvents, rideEvents, rideOffers, rides, users } from '../src/db/schema';

/**
 * Real end-to-end proof of docs/open-items.md #28: `POST /api/v1/rides` now rejects a second
 * ride for a user who already has a non-terminal one, with a clean 409
 * `ACTIVE_RIDE_ALREADY_EXISTS` - not a silently-created second active ride.
 *
 * `DispatchService` is replaced with an empty stub (`useValue({})`), not just
 * `DriverMatcherService` stubbed to return no candidates (as `test/idempotency.e2e-spec.ts`
 * does): with zero candidates, `DispatchService#onRideRequested` (open-items.md #9's
 * fire-and-forget `'ride.requested'` listener) still runs and transitions the ride to
 * NO_DRIVER_AVAILABLE almost immediately - which is itself a *terminal* status, so a test
 * trying to prove "a second create is rejected while the first is still active" would be racing
 * that background transition and could flake either way. Substituting the whole service with a
 * plain object means Nest's `@OnEvent('ride.requested')` discovery (which reads the decorator's
 * metadata off the real `DispatchService` class) finds no such method on this stub at all, so
 * the event goes genuinely unhandled here - the ride created by this suite stays in
 * SEARCHING_DRIVER until a test itself moves it, with no background race to out-wait. This test
 * is about the active-ride guard in `RidesService#create`, not about dispatch, so none of
 * `DispatchService`'s real behavior is needed. The ride itself is still created for real through
 * the real `create()` path.
 */
describe('Active ride conflict (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const [user] = await db
      .insert(users)
      .values({ name: 'Active Ride Conflict Test User', mobile: `active-ride-conflict-${Date.now()}` })
      .returning();
    userId = user.id;

    token = jwt.sign({ sub: userId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DispatchService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  /** Same retry-absorbing cleanup as idempotency.e2e-spec.ts, same reasoning (open-items.md #9). */
  async function cleanupRidesForUser(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rideRows = await db.select({ id: rides.id }).from(rides).where(eq(rides.userId, userId));
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
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  afterEach(async () => {
    await cleanupRidesForUser();
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await app.close();
    await pool.end();
  });

  const createBody = {
    pickupLatitude: 89.0,
    pickupLongitude: 179.0,
    destinationLatitude: 89.01,
    destinationLongitude: 179.01,
  };

  it('rejects a second POST /rides with 409 ACTIVE_RIDE_ALREADY_EXISTS while the first is still SEARCHING_DRIVER', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(201);
    expect(first.body.status).toBe('SEARCHING_DRIVER');

    const second = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(409);
    expect(second.body).toMatchObject({ code: 'ACTIVE_RIDE_ALREADY_EXISTS', rideId: first.body.id });

    const rideRows = await db.select().from(rides).where(eq(rides.userId, userId));
    expect(rideRows).toHaveLength(1);
  });

  it('allows a new ride once the first one reaches a terminal status', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/rides/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(201);
    expect(second.body.id).not.toBe(first.body.id);

    const rideRows = await db.select().from(rides).where(eq(rides.userId, userId));
    expect(rideRows).toHaveLength(2);
  });
});
