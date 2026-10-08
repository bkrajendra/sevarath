import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { MetricsPollerService } from '../src/metrics/metrics-poller.service';
import * as schema from '../src/db/schema';
import { drivers, outboxEvents, rideEvents, rideOffers, rides, users, vehicles } from '../src/db/schema';

/**
 * Real end-to-end proof of docs/plan.md Phase 9's observability work: `GET /metrics` is
 * reachable (unauthenticated, bare path, not versioned/prefixed - see metrics.controller.ts),
 * returns real Prometheus text-exposition output, and that output reflects real state - a
 * seeded driver/ride, and a counter that actually incremented from a real `POST /rides` call.
 *
 * `DispatchService` is replaced with an empty stub, same technique (and reasoning)
 * `test/active-ride-conflict.e2e-spec.ts` already established: with it stubbed, the real
 * `@OnEvent('ride.requested')` listener never runs, so the ride created by this suite stays in
 * `SEARCHING_DRIVER` (non-terminal) for the whole test instead of racing a background
 * transition to `NO_DRIVER_AVAILABLE`.
 *
 * `active_rides`/`available_drivers` are gauges refreshed by `MetricsPollerService` on a 20s
 * `@Interval` (see metrics-poller.service.ts) - far longer than this test should wait. Instead
 * of waiting for the real interval to fire, this test resolves `MetricsPollerService` from the
 * same app instance and calls its `poll()` method directly - the exact same method the
 * `@Interval` calls, just invoked on demand, so the assertions are against real DB state via
 * real code, not a shortcut around it.
 *
 * Own pickup/seed-data isolation island per the established docs/open-items.md #12/#18/#25/#26/
 * #30 convention (own coordinate, own naming prefixes) - see other suites' own comments for the
 * coordinates already in use, which this one avoids.
 */
describe('GET /metrics (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let poller: MetricsPollerService;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seededUserIds: string[] = [];
  const seededDriverIds: string[] = [];
  const seededVehicleIds: string[] = [];
  const seededRideIds: string[] = [];

  // Not used by any other suite - see this file's own doc comment.
  const pickup = { latitude: -45.0, longitude: 150.0 };
  const destination = { latitude: -45.01, longitude: 150.01 };

  async function makeUser(label: string, role: schema.User['role'] = 'USER') {
    const [user] = await db
      .insert(users)
      .values({ name: `Metrics E2E ${label}`, mobile: `metrics-e2e-${label}-${suffix}`, role })
      .returning();
    seededUserIds.push(user.id);
    return user;
  }

  async function makeAvailableDriver(label: string) {
    const vehicleUser = await makeUser(`drv-${label}`, 'DRIVER');
    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `METVEH-${label}-${suffix}`, status: 'AVAILABLE' })
      .returning();
    seededVehicleIds.push(vehicle.id);
    const [driver] = await db
      .insert(drivers)
      .values({
        userId: vehicleUser.id,
        driverCode: `METDRV-${label}-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        currentVehicleId: vehicle.id,
      })
      .returning();
    seededDriverIds.push(driver.id);
    return driver;
  }

  /**
   * A fresh rider + token per call - RidesService#create rejects a second non-terminal ride for
   * the same user (docs/open-items.md #28), and the rides this suite creates deliberately stay
   * non-terminal (DispatchService stubbed - see this file's own doc comment), so each test that
   * creates a ride needs its own rider rather than reusing one across tests.
   */
  async function makeRiderAndToken(label: string) {
    const rider = await makeUser(label);
    const token = jwt.sign({ sub: rider.id, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
    return { rider, token };
  }

  /** Reads a single bare (unlabeled) metric's current value out of the scraped text body. */
  function parseMetricValue(body: string, name: string): number {
    const match = body.match(new RegExp(`^${name} ([0-9eE+.\\-]+)$`, 'm'));
    if (!match) {
      throw new Error(`metric "${name}" not found in scraped output`);
    }
    return Number(match[1]);
  }

  /**
   * Root-cause fix for the same class of issue docs/open-items.md #18 already fixed for
   * assignment.service.integration-spec.ts: `active_rides`/`available_drivers` are plain,
   * unscoped `COUNT(*)`s over the whole shared Postgres, not limited to this suite's own rows -
   * if a PREVIOUS run of this file was interrupted (SIGKILL/timeout) after seeding but before
   * its own `afterAll` ran, the orphaned driver/ride rows it left behind would inflate these
   * exact gauges for every later run, well past this suite's own (unaffected-by-time)
   * `metrics-e2e-`/`METDRV-`/`METVEH-` naming convention. Swept in `beforeAll` *and* `afterAll`
   * so a crash on any run can never affect a later one.
   */
  async function purgeOrphanedFixtures(): Promise<void> {
    const orphanUsers = await db.select({ id: users.id }).from(users).where(like(users.mobile, 'metrics-e2e-%'));
    const userIds = orphanUsers.map((u) => u.id);
    if (userIds.length === 0) {
      return;
    }
    const orphanRides = await db.select({ id: rides.id }).from(rides).where(inArray(rides.userId, userIds));
    const rideIds = orphanRides.map((r) => r.id);
    if (rideIds.length > 0) {
      await db.delete(rideOffers).where(inArray(rideOffers.rideId, rideIds));
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, rideIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, rideIds));
      await db.delete(rides).where(inArray(rides.id, rideIds));
    }
    await db.delete(drivers).where(inArray(drivers.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(vehicles).where(like(vehicles.vehicleCode, 'METVEH-%'));
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    await purgeOrphanedFixtures();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DispatchService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live', 'metrics'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    poller = app.get(MetricsPollerService);
  });

  afterAll(async () => {
    if (seededRideIds.length > 0) {
      // ride_offers/ride_events/outbox_events all FK-reference rides.id - delete those first,
      // same order every other suite's own cleanup already uses (e.g. active-ride-conflict.e2e-spec.ts).
      await db.delete(rideOffers).where(inArray(rideOffers.rideId, seededRideIds));
      await db.delete(rideEvents).where(inArray(rideEvents.rideId, seededRideIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, seededRideIds));
      await db.delete(rides).where(inArray(rides.id, seededRideIds));
    }
    if (seededDriverIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.id, seededDriverIds));
    }
    if (seededVehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, seededVehicleIds));
    }
    if (seededUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, seededUserIds));
    }
    // Belt-and-suspenders, same as the beforeAll sweep - catches anything the explicit
    // per-id deletes above missed.
    await purgeOrphanedFixtures();
    await app.close();
    await pool.end();
  });

  it('is reachable at the bare /metrics path (not /api/v1/metrics) without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# TYPE ride_requests_total');

    // Not versioned/prefixed - a bare Prometheus scraper path, same treatment as /health.
    await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
    await request(app.getHttpServer()).get('/api/metrics').expect(404);
  });

  it('active_rides and available_drivers reflect real seeded DB state after a manual poll', async () => {
    // The gauge starts at prom-client's default of 0 until something actually calls poll() -
    // a plain GET /metrics never triggers one itself (that's the whole point of polling being
    // separate from scraping). Establish a REAL baseline with an explicit poll() first, so the
    // comparison below is "real poll before" vs. "real poll after", not "default 0" vs. "real
    // poll" (which would wrongly count every pre-existing row in the shared Postgres as if this
    // test had created it).
    await poller.poll();
    const baselineRes = await request(app.getHttpServer()).get('/metrics').expect(200);
    const baselineActiveRides = parseMetricValue(baselineRes.text, 'active_rides');
    const baselineAvailableDrivers = parseMetricValue(baselineRes.text, 'available_drivers');

    await makeAvailableDriver('a');
    await makeAvailableDriver('b');
    const { token } = await makeRiderAndToken('rider-active');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
      })
      .expect(201);
    seededRideIds.push(createRes.body.id);
    expect(createRes.body.status).toBe('SEARCHING_DRIVER'); // DispatchService stubbed - stays here.

    // Force the gauge refresh the real @Interval would otherwise only do every 20s (see this
    // file's own doc comment) - same method, invoked on demand against real DB state.
    await poller.poll();

    const afterRes = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(parseMetricValue(afterRes.text, 'active_rides')).toBe(baselineActiveRides + 1);
    expect(parseMetricValue(afterRes.text, 'available_drivers')).toBe(baselineAvailableDrivers + 2);
  });

  it('ride_requests_total increments by exactly one per successful POST /rides', async () => {
    const before = await request(app.getHttpServer()).get('/metrics').expect(200);
    const baseline = parseMetricValue(before.text, 'ride_requests_total');
    const { token } = await makeRiderAndToken('rider-count');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pickupLatitude: pickup.latitude + 0.2,
        pickupLongitude: pickup.longitude + 0.2,
        destinationLatitude: destination.latitude + 0.2,
        destinationLongitude: destination.longitude + 0.2,
      })
      .expect(201);
    seededRideIds.push(createRes.body.id);

    const after = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(parseMetricValue(after.text, 'ride_requests_total')).toBe(baseline + 1);
  });

  it('ride_cancelled_total{cancelled_by="USER"} increments on a real cancel', async () => {
    const { token } = await makeRiderAndToken('rider-cancel');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pickupLatitude: pickup.latitude + 0.4,
        pickupLongitude: pickup.longitude + 0.4,
        destinationLatitude: destination.latitude + 0.4,
        destinationLongitude: destination.longitude + 0.4,
      })
      .expect(201);
    seededRideIds.push(createRes.body.id);

    const before = await request(app.getHttpServer()).get('/metrics').expect(200);
    const match = before.text.match(/^ride_cancelled_total\{cancelled_by="USER"\} ([0-9.]+)$/m);
    const baseline = match ? Number(match[1]) : 0;

    await request(app.getHttpServer())
      .post(`/api/v1/rides/${createRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const after = await request(app.getHttpServer()).get('/metrics').expect(200);
    const afterMatch = after.text.match(/^ride_cancelled_total\{cancelled_by="USER"\} ([0-9.]+)$/m);
    expect(afterMatch).not.toBeNull();
    expect(Number(afterMatch![1])).toBe(baseline + 1);
  });
});
