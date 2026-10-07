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
import { DRIZZLE } from '../src/db/drizzle.module';
import { DriverMatcherService } from '../src/dispatch/driver-matcher.service';
import * as schema from '../src/db/schema';
import {
  idempotencyKeys,
  outboxEvents,
  rideEvents,
  rideOffers,
  rides,
  users,
} from '../src/db/schema';

/**
 * Real end-to-end proof of specification.md §11.1 / architecture.md §6.2: this test does NOT
 * mock DRIZZLE (unlike test/app.e2e-spec.ts) - it boots the full AppModule against the real
 * local Postgres so it can actually prove deduplication at the database level, not just that
 * the interceptor's internals were called.
 */
describe('Idempotency-Key (e2e, real Postgres)', () => {
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
      .values({ name: 'Idempotency Test User', mobile: `idem-test-${Date.now()}` })
      .returning();
    userId = user.id;

    token = jwt.sign({ sub: userId, role: 'USER' }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // RidesService.create() fires an in-process 'ride.requested' event that DispatchModule
      // handles fire-and-forget (open-items.md #9), which would otherwise run a REAL,
      // distance-unbounded driver match (driver-matcher.service.ts has no max-distance cutoff -
      // see docs/open-items.md #2/#10/#12) against whatever AVAILABLE drivers any OTHER
      // integration suite happens to have seeded in this same shared Postgres instance at that
      // moment, racing to insert/delete ride_offers rows against drivers this test doesn't own.
      // This test is about idempotency, not dispatch matching, so candidates are stubbed to
      // none - the ride itself is still created for real, through the real create() path.
      .overrideProvider(DriverMatcherService)
      .useValue({ findCandidates: async () => [] })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  /**
   * RidesService.create() emits an in-process 'ride.requested' event (open-items.md #9) that
   * DispatchModule's listener handles fire-and-forget - it is not awaited by the HTTP response,
   * so it can still be inserting its own ride_events/outbox_events rows (e.g. transitioning an
   * unmatched ride to NO_DRIVER_AVAILABLE) for a moment after a test's assertions already ran.
   * Retrying the child-table cleanup a few times (instead of a single delete pass) absorbs that
   * harmless race instead of failing on a foreign-key violation.
   */
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
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await app.close();
    await pool.end();
  });

  const createBody = {
    pickupLatitude: 24.9,
    pickupLongitude: 72.7,
    destinationLatitude: 24.91,
    destinationLongitude: 72.71,
  };

  it('two sequential POST /api/v1/rides with the same Idempotency-Key create exactly one ride and return the same ride id', async () => {
    const idempotencyKey = `idem-create-${Date.now()}-a`;

    const first = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(createBody)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(createBody)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    const rideRows = await db.select().from(rides).where(eq(rides.userId, userId));
    expect(rideRows).toHaveLength(1);
    expect(rideRows[0].id).toBe(first.body.id);

    const [storedKey] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, idempotencyKey));
    expect(storedKey.status).toBe('COMPLETED');
    expect((storedKey.responseBody as { id: string }).id).toBe(first.body.id);
  });

  it('a POST without an Idempotency-Key header still works, and creates its own ride without touching idempotency_keys', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody)
      .expect(201);

    const rideRows = await db.select().from(rides).where(eq(rides.userId, userId));
    expect(rideRows).toHaveLength(1);
    expect(rideRows[0].id).toBe(res.body.id);

    const keyRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
    expect(keyRows).toHaveLength(0);
  });

  it('concurrent POST /api/v1/rides with the same Idempotency-Key never create a second ride', async () => {
    const idempotencyKey = `idem-create-${Date.now()}-concurrent`;

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(createBody),
      request(app.getHttpServer())
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(createBody),
    ]);

    // Both requests resolve (supertest never rejects on a non-2xx response), but we assert on
    // their individual outcomes below.
    const responses = results.map((r) => {
      if (r.status !== 'fulfilled') {
        throw new Error(`request failed outright: ${String((r as PromiseRejectedResult).reason)}`);
      }
      return r.value;
    });

    // Every response is either the successful (possibly replayed) creation, or a 409 for the
    // genuinely-concurrent duplicate still in progress - never a silent second ride.
    for (const res of responses) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 409) {
        expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
      }
    }

    const successes = responses.filter((r) => r.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    const rideIds = new Set(successes.map((r) => r.body.id));
    expect(rideIds.size).toBe(1);

    const rideRows = await db.select().from(rides).where(eq(rides.userId, userId));
    expect(rideRows).toHaveLength(1);
  });
});
