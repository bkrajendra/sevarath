import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { campusLocations, type NewCampusLocation } from './schema';

// Same nine campus locations the Flutter app's mock data used, with real
// coordinates in the Abu Road / Shantivan bbox already referenced elsewhere
// in the app (e.g. apps/mobile lib/features/ride/confirm_ride_screen.dart).
const locations: NewCampusLocation[] = [
  { name: 'Main Gate', type: 'GATE', latitude: 24.4828, longitude: 72.782, description: 'Headquarters' },
  { name: 'Reception', type: 'RECEPTION', latitude: 24.4832, longitude: 72.7825, description: 'Administration' },
  { name: 'Shantivan', type: 'BUILDING', latitude: 24.485, longitude: 72.785, description: 'Meditation Complex' },
  { name: 'Gyan Sarovar', type: 'OTHER', latitude: 24.4815, longitude: 72.7808, description: 'Lake Area' },
  { name: 'Tapovan', type: 'RESIDENCE', latitude: 24.4841, longitude: 72.7838, description: 'Accommodation' },
  { name: 'Dining Hall', type: 'DINING', latitude: 24.4836, longitude: 72.7816, description: 'Food Court' },
  { name: 'Hospital', type: 'MEDICAL', latitude: 24.4822, longitude: 72.7831, description: 'Medical Services' },
  { name: 'Parking Area', type: 'PARKING', latitude: 24.4826, longitude: 72.7812, description: 'EV Parking' },
  { name: 'Om Shanti Bhawan', type: 'BUILDING', latitude: 24.4845, longitude: 72.7822, description: 'Conference Hall' },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const existing = await db.select().from(campusLocations).limit(1);
  if (existing.length > 0) {
    console.log('campus_locations already has data - skipping seed');
    await pool.end();
    return;
  }

  await db.insert(campusLocations).values(locations);
  console.log(`Seeded ${locations.length} campus locations`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
