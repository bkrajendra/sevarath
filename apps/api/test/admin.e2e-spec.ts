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
import { drivers, rides, users, vehicles } from '../src/db/schema';

/**
 * Phase 8 ("Admin Operations") cross-cutting endpoints - against the real local Postgres (not
 * mocked), same pattern as test/device-tokens.e2e-spec.ts: full HTTP stack via supertest, real
 * JWTs, so RolesGuard's ADMIN/OPERATOR behavior is actually exercised, not just the service
 * layer underneath it.
 *
 * Own pickup/seed-data isolation island per the established docs/open-items.md #12/#18/#25/
 * #26/#30 convention: `admin-e2e-` user mobiles, `ADME2E-` driver codes, `ADMVEH-` vehicle
 * codes, and a far-away pickup/location coordinate (-10.0, -10.0) not used by any other suite
 * (assignment.service: 1.0/1.0; driver-matcher/rides.service: 24.9/72.7; realtime-ride-events:
 * 80.0/80.0; location-sync: 35.0/35.0).
 *
 * The dashboard-summary assertions are *delta*-based (fetch a baseline before seeding, assert
 * the post-seed counts increased by exactly what this suite added), not absolute - the endpoint
 * is deliberately campus-wide/unscoped (that's the point of a dashboard), so asserting an
 * absolute count would be fragile against whatever other suites' own fixtures happen to be
 * live in the shared Postgres at the same time.
 */
describe('Admin operations (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let adminToken: string;
  let operatorToken: string;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seededUserIds: string[] = [];
  const seededDriverIds: string[] = [];
  const seededVehicleIds: string[] = [];
  const seededRideIds: string[] = [];

  async function makeUser(label: string, role: schema.User['role'] = 'USER') {
    const [user] = await db
      .insert(users)
      .values({ name: `Admin E2E ${label}`, mobile: `admin-e2e-${label}-${suffix}`, role })
      .returning();
    seededUserIds.push(user.id);
    return user;
  }

  async function makeVehicle(label: string, status: schema.Vehicle['status']) {
    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `ADMVEH-${label}-${suffix}`, status })
      .returning();
    seededVehicleIds.push(vehicle.id);
    return vehicle;
  }

  async function makeDriver(
    label: string,
    opts: {
      availability?: schema.Driver['availability'];
      currentVehicleId?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } = {},
  ) {
    const user = await makeUser(`drv-${label}`, 'DRIVER');
    const [driver] = await db
      .insert(drivers)
      .values({
        userId: user.id,
        driverCode: `ADME2E-${label}-${suffix}`,
        status: 'ACTIVE',
        availability: opts.availability ?? 'OFFLINE',
        currentVehicleId: opts.currentVehicleId ?? null,
        currentLatitude: opts.latitude ?? null,
        currentLongitude: opts.longitude ?? null,
        locationUpdatedAt: opts.latitude != null ? new Date() : null,
      })
      .returning();
    seededDriverIds.push(driver.id);
    return driver;
  }

  async function makeRide(
    riderId: string,
    status: schema.Ride['status'],
    opts: { driverId?: string | null; requestedAt?: Date } = {},
  ) {
    const [ride] = await db
      .insert(rides)
      .values({
        userId: riderId,
        driverId: opts.driverId ?? null,
        pickupLatitude: -10.0,
        pickupLongitude: -10.0,
        destinationLatitude: -10.01,
        destinationLongitude: -10.01,
        status,
      })
      .returning();
    seededRideIds.push(ride.id);

    if (opts.requestedAt) {
      await db.update(rides).set({ requestedAt: opts.requestedAt }).where(eq(rides.id, ride.id));
    }

    const [current] = await db.select().from(rides).where(eq(rides.id, ride.id));
    return current;
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const adminUser = await makeUser('admin', 'ADMIN');
    adminToken = jwt.sign({ sub: adminUser.id, role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const operatorUser = await makeUser('operator', 'OPERATOR');
    operatorToken = jwt.sign({ sub: operatorUser.id, role: 'OPERATOR' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (seededRideIds.length > 0) {
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
    await app.close();
    await pool.end();
  });

  describe('GET /api/v1/admin/dashboard/summary', () => {
    it('reflects seeded vehicle/driver/active-ride counts as a delta over baseline, for ADMIN and OPERATOR', async () => {
      const baseline = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const rider = await makeUser('dash-rider');
      await makeVehicle('dash-1', 'AVAILABLE');
      await makeVehicle('dash-2', 'AVAILABLE');
      await makeVehicle('dash-3', 'MAINTENANCE');
      await makeDriver('dash-1', { availability: 'AVAILABLE' });
      await makeDriver('dash-2', { availability: 'BUSY' });
      await makeRide(rider.id, 'SEARCHING_DRIVER'); // non-terminal -> +1 active
      await makeRide(rider.id, 'COMPLETED'); // terminal -> no change to active count

      const [adminRes, operatorRes] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/v1/admin/dashboard/summary')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
        request(app.getHttpServer())
          .get('/api/v1/admin/dashboard/summary')
          .set('Authorization', `Bearer ${operatorToken}`)
          .expect(200),
      ]);

      for (const res of [adminRes, operatorRes]) {
        expect(res.body.vehiclesByStatus.AVAILABLE - baseline.body.vehiclesByStatus.AVAILABLE).toBe(2);
        expect(res.body.vehiclesByStatus.MAINTENANCE - baseline.body.vehiclesByStatus.MAINTENANCE).toBe(1);
        expect(res.body.driversByAvailability.AVAILABLE - baseline.body.driversByAvailability.AVAILABLE).toBe(1);
        expect(res.body.driversByAvailability.BUSY - baseline.body.driversByAvailability.BUSY).toBe(1);
        expect(res.body.activeRidesCount - baseline.body.activeRidesCount).toBe(1);
      }
    });

    it('rejects a USER-role caller with 403', async () => {
      const plainUser = await makeUser('plain-dashboard');
      const plainToken = jwt.sign({ sub: plainUser.id, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
        expiresIn: '15m',
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${plainToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/rides', () => {
    it('filters by status, date range, userId/driverId, and paginates newest-first', async () => {
      const rider = await makeUser('rides-rider');
      const otherRider = await makeUser('rides-other-rider');
      const driver = await makeDriver('rides-filter', { availability: 'BUSY' });

      const old = await makeRide(rider.id, 'COMPLETED', {
        requestedAt: new Date('2020-01-01T00:00:00Z'),
      });
      const middle = await makeRide(rider.id, 'SEARCHING_DRIVER', {
        requestedAt: new Date('2020-06-01T00:00:00Z'),
      });
      const recentWithDriver = await makeRide(rider.id, 'DRIVER_ASSIGNED', {
        driverId: driver.id,
        requestedAt: new Date('2020-09-01T00:00:00Z'),
      });
      await makeRide(otherRider.id, 'COMPLETED', {
        requestedAt: new Date('2020-09-02T00:00:00Z'),
      });

      // status filter
      const byStatus = await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .query({ status: 'SEARCHING_DRIVER', userId: rider.id })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(byStatus.body.items.map((r: { id: string }) => r.id)).toEqual([middle.id]);
      expect(byStatus.body.total).toBe(1);

      // date range filter (inclusive bounds), scoped to our rider to ignore other suites' rows
      const byDateRange = await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .query({
          userId: rider.id,
          requestedAfter: '2020-05-01T00:00:00Z',
          requestedBefore: '2020-09-01T00:00:00Z',
        })
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const dateRangeIds = byDateRange.body.items.map((r: { id: string }) => r.id);
      expect(dateRangeIds.sort()).toEqual([middle.id, recentWithDriver.id].sort());

      // driverId filter
      const byDriver = await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .query({ driverId: driver.id })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(byDriver.body.items.map((r: { id: string }) => r.id)).toEqual([recentWithDriver.id]);

      // pagination + newest-first ordering, scoped to our rider
      const page1 = await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .query({ userId: rider.id, limit: 1, offset: 0 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.items[0].id).toBe(recentWithDriver.id);
      expect(page1.body.total).toBe(3);

      const page2 = await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .query({ userId: rider.id, limit: 1, offset: 1 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page2.body.items[0].id).toBe(middle.id);

      void old;
    });

    it('rejects a USER-role caller with 403', async () => {
      const plainUser = await makeUser('plain-rides');
      const plainToken = jwt.sign({ sub: plainUser.id, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
        expiresIn: '15m',
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/rides')
        .set('Authorization', `Bearer ${plainToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/live-map', () => {
    it('returns only drivers with a location set, with availability/location/active-ride fields', async () => {
      const withLocationIdle = await makeDriver('map-idle', {
        availability: 'AVAILABLE',
        latitude: -10.5,
        longitude: -10.5,
      });
      const rider = await makeUser('map-rider');
      const withLocationBusy = await makeDriver('map-busy', {
        availability: 'BUSY',
        latitude: -10.6,
        longitude: -10.6,
      });
      await makeRide(rider.id, 'DRIVER_ASSIGNED', { driverId: withLocationBusy.id });
      const withoutLocation = await makeDriver('map-no-location', { availability: 'OFFLINE' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/live-map')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const byDriverId = new Map(res.body.map((row: { driverId: string }) => [row.driverId, row]));

      expect(byDriverId.has(withoutLocation.id)).toBe(false);

      const idleRow = byDriverId.get(withLocationIdle.id) as Record<string, unknown>;
      expect(idleRow).toMatchObject({
        availability: 'AVAILABLE',
        latitude: -10.5,
        longitude: -10.5,
        activeRideId: null,
        activeRideStatus: null,
      });
      expect(idleRow.locationUpdatedAt).toBeTruthy();

      const busyRow = byDriverId.get(withLocationBusy.id) as Record<string, unknown>;
      expect(busyRow).toMatchObject({
        availability: 'BUSY',
        latitude: -10.6,
        longitude: -10.6,
        activeRideStatus: 'DRIVER_ASSIGNED',
      });
      expect(typeof busyRow.activeRideId).toBe('string');
    });

    it('rejects a USER-role caller with 403', async () => {
      const plainUser = await makeUser('plain-livemap');
      const plainToken = jwt.sign({ sub: plainUser.id, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
        expiresIn: '15m',
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/live-map')
        .set('Authorization', `Bearer ${plainToken}`)
        .expect(403);
    });
  });
});
