import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { campusBoundaries, campusLocations, type NewCampusLocation } from './schema';

// Real named locations within 500m of Diamond Hall Shanti Van, Abu Road -
// the actual campus this app is built for - sourced from Google Maps (name
// + exact coordinates per place; OSM data for this specific campus was too
// sparse to be useful). Replaces the earlier placeholder/approximate list.
const locations: NewCampusLocation[] = [
  {
    name: 'Diamond Hall Shanti Van',
    type: 'BUILDING',
    latitude: 24.5313075,
    longitude: 72.7947805,
    description: 'Conference Hall',
  },
  {
    name: 'Prajapita Brahma Kumaris Ishwariya Vishwa Vidyalaya',
    type: 'BUILDING',
    latitude: 24.531874,
    longitude: 72.795019,
    description: 'University',
  },
  { name: 'Nirman Parking I', type: 'PARKING', latitude: 24.5311951, longitude: 72.7940133, description: 'Parking' },
  {
    name: 'Ever Healthy Hospital',
    type: 'MEDICAL',
    latitude: 24.5302854,
    longitude: 72.7949448,
    description: 'Medical Wing',
  },
  { name: 'Parking Place', type: 'PARKING', latitude: 24.5309793, longitude: 72.7962205, description: 'Parking' },
  { name: 'Parking', type: 'PARKING', latitude: 24.5323427, longitude: 72.7959754, description: 'Parking' },
  {
    name: 'Shantivan Gate No 03',
    type: 'GATE',
    latitude: 24.5317369,
    longitude: 72.7930659,
    description: 'Campus Gate',
  },
  {
    name: 'Diamond Hall & Prakash Stambh',
    type: 'BUILDING',
    latitude: 24.5296833,
    longitude: 72.7940231,
    description: 'Monument & Hall',
  },
  {
    name: 'Shantivan Gate No 06',
    type: 'GATE',
    latitude: 24.5306169,
    longitude: 72.79699,
    description: 'Campus Gate',
  },
  {
    name: 'Parking Diamond Cottage',
    type: 'PARKING',
    latitude: 24.533201,
    longitude: 72.796139,
    description: 'Parking',
  },
  {
    name: 'Shantivan Gate No 02',
    type: 'GATE',
    latitude: 24.5289796,
    longitude: 72.795909,
    description: 'Campus Gate',
  },
  {
    name: 'Shantivan Gate No 01',
    type: 'GATE',
    latitude: 24.5315397,
    longitude: 72.7977126,
    description: 'Campus Gate',
  },
  { name: 'Parking Lot', type: 'PARKING', latitude: 24.5284925, longitude: 72.7951851, description: 'Parking' },
  {
    name: 'BrahmaKumaris Prem Niwas',
    type: 'RESIDENCE',
    latitude: 24.5285499,
    longitude: 72.7963762,
    description: 'Residence',
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const existing = await db.select().from(campusLocations).limit(1);
  if (existing.length > 0) {
    console.log('campus_locations already has data - skipping seed');
  } else {
    await db.insert(campusLocations).values(locations);
    console.log(`Seeded ${locations.length} campus locations`);
  }

  await seedCampusBoundary(db);
  await pool.end();
}

/**
 * Seeds the dispatch geofence boundary (driver-matcher.service.ts, architecture.md §4.2 step
 * 3) as the convex hull of every active `campus_locations` point, buffered 60m for margin at
 * the campus edge - not a hand-guessed polygon. Wrapped in try/catch, not the hard failure the
 * locations seed above is: a dev/CI sandbox without the PostGIS extension (docs/open-items.md
 * #1) can't run this, but should still get a usable `campus_locations` seed for everything
 * else that doesn't need PostGIS.
 */
async function seedCampusBoundary(db: ReturnType<typeof drizzle>) {
  const existingBoundary = await db.select().from(campusBoundaries).limit(1);
  if (existingBoundary.length > 0) {
    console.log('campus_boundaries already has data - skipping seed');
    return;
  }

  try {
    await db.execute(sql`
      INSERT INTO campus_boundaries (name, geom)
      SELECT
        'Diamond Hall Shanti Van Campus',
        ST_Buffer(
          ST_ConvexHull(ST_Collect(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)))::geography,
          60
        )::geometry
      FROM campus_locations
      WHERE is_active = true
    `);
    console.log('Seeded campus boundary (convex hull of campus_locations, +60m buffer)');
  } catch (err) {
    console.warn(
      `Skipped campus boundary seed - PostGIS likely unavailable in this database: ${(err as Error).message}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
