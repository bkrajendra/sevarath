import 'reflect-metadata';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as schema from '../src/db/schema';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

/**
 * Requires a real Postgres (see .github/workflows/ci.yml's `postgres` service and
 * DATABASE_URL) - password hashing/verification and the duplicate-account check are
 * cheap to get subtly wrong and worth proving against real inserts, not mocks.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('AuthService password auth (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let usersService: UsersService;
  let authService: AuthService;
  const testMobile = '+910000000098';

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    usersService = new UsersService(db);
    const config = new ConfigService({
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_REFRESH_TTL: '30d',
    });
    authService = new AuthService(usersService, new JwtService({}), config);
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.mobile, testMobile));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers a new user, hashes the password, and issues tokens', async () => {
    const result = await authService.register({
      name: 'Password Test User',
      mobile: testMobile,
      email: 'password-auth-test@example.com',
      password: 'correct horse battery staple',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.role).toBe('USER');

    const stored = await usersService.findByMobileOrEmail(testMobile);
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe('correct horse battery staple');
  });

  it('rejects registration with a mobile number that is already in use', async () => {
    await authService.register({ name: 'First', mobile: testMobile, password: 'password one' });

    await expect(
      authService.register({ name: 'Second', mobile: testMobile, password: 'password two' }),
    ).rejects.toThrow('An account with this mobile number or email already exists');
  });

  it('logs in with the correct password using mobile as the identifier', async () => {
    await authService.register({ name: 'Login Test', mobile: testMobile, password: 'correct horse battery staple' });

    const result = await authService.loginWithPassword({
      identifier: testMobile,
      password: 'correct horse battery staple',
    });

    expect(result.accessToken).toBeDefined();
  });

  it('rejects an incorrect password', async () => {
    await authService.register({ name: 'Wrong Pw Test', mobile: testMobile, password: 'correct horse battery staple' });

    await expect(
      authService.loginWithPassword({ identifier: testMobile, password: 'wrong password' }),
    ).rejects.toThrow('Invalid mobile/email or password');
  });

  it('rejects password login for a Firebase-only account with no password set', async () => {
    await usersService.create({
      name: 'Firebase Only',
      mobile: testMobile,
      role: 'USER',
      status: 'ACTIVE',
      firebaseUid: 'some-firebase-uid-for-test',
    });

    await expect(
      authService.loginWithPassword({ identifier: testMobile, password: 'anything' }),
    ).rejects.toThrow('Invalid mobile/email or password');
  });
});
