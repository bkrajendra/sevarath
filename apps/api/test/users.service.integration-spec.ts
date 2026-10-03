import 'reflect-metadata';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { UsersService } from '../src/users/users.service';

/**
 * Requires a real Postgres (see .github/workflows/ci.yml's `postgres` service and
 * DATABASE_URL) - this behavior was changed as a direct fix for a login bug and a
 * mocked DB wouldn't actually prove the SQL is case-insensitive.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('UsersService (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let usersService: UsersService;
  const testMobile = '+910000000099';

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    usersService = new UsersService(db);
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.mobile, testMobile));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('finds a pre-provisioned account by email regardless of case', async () => {
    await usersService.create({
      name: 'Test Admin',
      mobile: testMobile,
      email: 'Mixed.Case@Example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      firebaseUid: 'integration-test-placeholder-uid',
    });

    const found = await usersService.findByMobileOrEmail(undefined, 'mixed.case@example.com');

    expect(found).toBeDefined();
    expect(found?.mobile).toBe(testMobile);
  });

  it('links a Firebase UID onto the matched record, not a new one', async () => {
    const created = await usersService.create({
      name: 'Test Admin 2',
      mobile: testMobile,
      email: 'another@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      firebaseUid: 'integration-test-placeholder-uid-2',
    });

    const linked = await usersService.linkFirebaseUid(created.id, 'real-firebase-uid');

    expect(linked.id).toBe(created.id);
    expect(linked.firebaseUid).toBe('real-firebase-uid');

    const byUid = await usersService.findByFirebaseUid('real-firebase-uid');
    expect(byUid?.id).toBe(created.id);
  });
});
