import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import { campusBoundaries, drivers, users, vehicles } from '../db/schema';
import { DriverMatcherService, LOCATION_STALENESS_WINDOW_MS } from './driver-matcher.service';

describe('DriverMatcherService (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: DriverMatcherService;

  const pickup = { latitude: 24.9, longitude: 72.7 };
  const userIds: string[] = [];
  const vehicleIds: string[] = [];
  const driverIds: Record<string, string> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new DriverMatcherService(db as any);

    const makeDriver = async (
      label: string,
      opts: {
        availability?: 'OFFLINE' | 'AVAILABLE' | 'BUSY' | 'ON_BREAK';
        status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
        vehicleStatus?: 'AVAILABLE' | 'IN_SERVICE' | 'MAINTENANCE' | 'INACTIVE';
        offsetDegrees?: number;
        locationAgeMs?: number;
        noVehicle?: boolean;
        noLocation?: boolean;
      } = {},
    ) => {
      const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const [user] = await db
        .insert(users)
        .values({ name: `Matcher Test ${label}`, mobile: `matcher-${suffix}` })
        .returning();
      userIds.push(user.id);

      let vehicleId: string | null = null;
      if (!opts.noVehicle) {
        const [vehicle] = await db
          .insert(vehicles)
          .values({
            vehicleCode: `MATCH-${suffix}`,
            status: opts.vehicleStatus ?? 'AVAILABLE',
          })
          .returning();
        vehicleIds.push(vehicle.id);
        vehicleId = vehicle.id;
      }

      const locationUpdatedAt = opts.noLocation
        ? null
        : new Date(Date.now() - (opts.locationAgeMs ?? 0));

      const [driver] = await db
        .insert(drivers)
        .values({
          userId: user.id,
          driverCode: `DRV-${suffix}`,
          status: opts.status ?? 'ACTIVE',
          availability: opts.availability ?? 'AVAILABLE',
          currentVehicleId: vehicleId,
          currentLatitude: opts.noLocation ? null : pickup.latitude + (opts.offsetDegrees ?? 0),
          currentLongitude: opts.noLocation ? null : pickup.longitude,
          locationUpdatedAt,
        })
        .returning();
      driverIds[label] = driver.id;
      return driver;
    };

    // Nearest: ~0.01 deg away (~1.1km).
    await makeDriver('near', { offsetDegrees: 0.01 });
    // Farther: ~0.1 deg away (~11km).
    await makeDriver('far', { offsetDegrees: 0.1 });
    // Excluded by staleness: location older than the staleness window.
    await makeDriver('stale', {
      offsetDegrees: 0.01,
      locationAgeMs: LOCATION_STALENESS_WINDOW_MS + 60_000,
    });
    // Excluded by availability.
    await makeDriver('offline', { offsetDegrees: 0.01, availability: 'OFFLINE' });
    // Excluded by driver status.
    await makeDriver('suspended', { offsetDegrees: 0.01, status: 'SUSPENDED' });
    // Excluded by vehicle status (maintenance).
    await makeDriver('maintenance', { offsetDegrees: 0.01, vehicleStatus: 'MAINTENANCE' });
    // Excluded by having no vehicle assigned.
    await makeDriver('novehicle', { offsetDegrees: 0.01, noVehicle: true });
    // Excluded by having no location.
    await makeDriver('nolocation', { noLocation: true });
  });

  afterAll(async () => {
    await db.delete(drivers).where(inArray(drivers.userId, userIds));
    await db.delete(vehicles).where(inArray(vehicles.id, vehicleIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  });

  it('returns only AVAILABLE/ACTIVE drivers with a fresh location and an AVAILABLE vehicle, nearest first', async () => {
    const candidates = await service.findCandidates(pickup, []);
    const ids = candidates.map((c) => c.id);

    expect(ids).toContain(driverIds.near);
    expect(ids).toContain(driverIds.far);
    expect(ids).not.toContain(driverIds.stale);
    expect(ids).not.toContain(driverIds.offline);
    expect(ids).not.toContain(driverIds.suspended);
    expect(ids).not.toContain(driverIds.maintenance);
    expect(ids).not.toContain(driverIds.novehicle);
    expect(ids).not.toContain(driverIds.nolocation);

    expect(ids.indexOf(driverIds.near)).toBeLessThan(ids.indexOf(driverIds.far));

    const near = candidates.find((c) => c.id === driverIds.near)!;
    const far = candidates.find((c) => c.id === driverIds.far)!;
    expect(near.distanceMeters).toBeLessThan(far.distanceMeters);
  });

  it('excludes explicitly-listed driver ids', async () => {
    const candidates = await service.findCandidates(pickup, [driverIds.near]);
    const ids = candidates.map((c) => c.id);

    expect(ids).not.toContain(driverIds.near);
    expect(ids).toContain(driverIds.far);
  });

  describe('campus geofence filtering', () => {
    let boundaryId: string;

    beforeAll(async () => {
      // A ~0.03 deg box around `pickup` covers `near` (0.01 deg offset) but not `far`
      // (0.1 deg offset) - see the offset comments in the outer beforeAll. Built as GeoJSON
      // via ST_GeomFromGeoJSON, matching campus-restricted-zones.service.ts's own convention.
      const box = {
        type: 'Polygon',
        coordinates: [
          [
            [pickup.longitude - 0.03, pickup.latitude - 0.03],
            [pickup.longitude + 0.03, pickup.latitude - 0.03],
            [pickup.longitude + 0.03, pickup.latitude + 0.03],
            [pickup.longitude - 0.03, pickup.latitude + 0.03],
            [pickup.longitude - 0.03, pickup.latitude - 0.03],
          ],
        ],
      };
      const [boundary] = await db
        .insert(campusBoundaries)
        .values({
          name: `Matcher Test Boundary ${Date.now()}`,
          geom: sql`ST_GeomFromGeoJSON(${JSON.stringify(box)})`,
        })
        .returning();
      boundaryId = boundary.id;
    });

    afterAll(async () => {
      await db.delete(campusBoundaries).where(eq(campusBoundaries.id, boundaryId));
    });

    it('once a boundary is active, excludes drivers whose location falls outside every active polygon', async () => {
      const candidates = await service.findCandidates(pickup, []);
      const ids = candidates.map((c) => c.id);

      expect(ids).toContain(driverIds.near);
      expect(ids).not.toContain(driverIds.far);
    });

    it('an inactive boundary is ignored (same as having none)', async () => {
      await db
        .update(campusBoundaries)
        .set({ isActive: false })
        .where(eq(campusBoundaries.id, boundaryId));

      const candidates = await service.findCandidates(pickup, []);
      const ids = candidates.map((c) => c.id);
      expect(ids).toContain(driverIds.far);

      await db
        .update(campusBoundaries)
        .set({ isActive: true })
        .where(eq(campusBoundaries.id, boundaryId));
    });
  });
});
