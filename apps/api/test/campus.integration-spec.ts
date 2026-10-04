import 'reflect-metadata';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { CampusRoadsService } from '../src/campus/campus-roads.service';
import { CampusRestrictedZonesService } from '../src/campus/campus-restricted-zones.service';

/**
 * PostGIS geometry I/O (ST_GeomFromGeoJSON/ST_AsGeoJSON) through Drizzle's raw `sql`
 * fragments is new, easy-to-get-subtly-wrong territory - a mocked DB can't prove the
 * coordinates actually round-trip correctly, so this needs a real Postgres.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Campus geometry round-trip (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let roadsService: CampusRoadsService;
  let zonesService: CampusRestrictedZonesService;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    roadsService = new CampusRoadsService(db);
    zonesService = new CampusRestrictedZonesService(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips a LineString through ST_GeomFromGeoJSON/ST_AsGeoJSON', async () => {
    const coordinates: [number, number][] = [
      [72.1234, 24.5921],
      [72.1240, 24.5925],
      [72.1250, 24.5930],
    ];

    const created = await roadsService.create({
      name: 'Integration test road',
      geometry: { type: 'LineString', coordinates },
    });

    try {
      expect(created.geometry.type).toBe('LineString');
      expect(created.geometry.coordinates).toEqual(coordinates);

      const all = await roadsService.findAll(true);
      const found = all.find((r) => r.id === created.id);
      expect(found?.geometry.coordinates).toEqual(coordinates);
    } finally {
      await db.delete(schema.campusRoads).where(eq(schema.campusRoads.id, created.id));
    }
  });

  it('round-trips a Polygon and setActive() toggles correctly', async () => {
    const coordinates: [number, number][][] = [
      [
        [72.1, 24.59],
        [72.101, 24.59],
        [72.101, 24.591],
        [72.1, 24.591],
        [72.1, 24.59],
      ],
    ];

    const created = await zonesService.create({
      name: 'Integration test zone',
      reason: 'testing',
      geometry: { type: 'Polygon', coordinates },
    });

    try {
      expect(created.geometry.coordinates).toEqual(coordinates);
      expect(created.isActive).toBe(true);

      const deactivated = await zonesService.setActive(created.id, false);
      expect(deactivated.isActive).toBe(false);

      const activeOnly = await zonesService.findAll(false);
      expect(activeOnly.find((z) => z.id === created.id)).toBeUndefined();
    } finally {
      await db.delete(schema.campusRestrictedZones).where(eq(schema.campusRestrictedZones.id, created.id));
    }
  });
});
