import 'reflect-metadata';
import { createHash } from 'crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as schema from '../src/db/schema';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { MailService } from '../src/mail/mail.service';

/** Mirrors `hashResetCode` in auth.service.ts - not exported, so re-derived here for test setup. */
function hashResetCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

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
    authService = new AuthService(usersService, new JwtService({}), config, new MailService(config), db);
  });

  afterEach(async () => {
    // Registration/login now record a `refresh_tokens` row (this task) - its FK to `users`
    // means those rows must be deleted before the user row they reference, or the delete
    // below fails with a foreign-key violation.
    const existing = await usersService.findByMobileOrEmail(testMobile);
    if (existing) {
      await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, existing.id));
      await db.delete(schema.passwordResetCodes).where(eq(schema.passwordResetCodes.userId, existing.id));
    }
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

  describe('password reset', () => {
    const testEmail = 'password-reset-test@example.com';

    it('does not throw for an identifier that matches no account', async () => {
      await expect(authService.requestPasswordReset('+910000000000')).resolves.toBeUndefined();
    });

    it('creates a reset code row for a user with an email on file, and supersedes it on a second request', async () => {
      await authService.register({
        name: 'Reset Test',
        mobile: testMobile,
        email: testEmail,
        password: 'correct horse battery staple',
      });
      const user = await usersService.findByMobileOrEmail(testMobile);

      await authService.requestPasswordReset(testEmail);
      const [firstRow] = await db
        .select()
        .from(schema.passwordResetCodes)
        .where(and(eq(schema.passwordResetCodes.userId, user!.id), isNull(schema.passwordResetCodes.usedAt)));
      expect(firstRow).toBeDefined();
      expect(firstRow!.codeHash).not.toBe('');

      await authService.requestPasswordReset(testEmail);
      const stillUnused = await db
        .select()
        .from(schema.passwordResetCodes)
        .where(and(eq(schema.passwordResetCodes.userId, user!.id), isNull(schema.passwordResetCodes.usedAt)));
      // The first request's row was superseded (usedAt set) by the second - only one
      // currently-unused row should remain.
      expect(stillUnused).toHaveLength(1);
      expect(stillUnused[0]!.id).not.toBe(firstRow!.id);
    });

    it('resets the password with a valid code, marks it used, and revokes existing refresh tokens', async () => {
      await authService.register({
        name: 'Reset Confirm Test',
        mobile: testMobile,
        email: testEmail,
        password: 'original password',
      });
      const user = await usersService.findByMobileOrEmail(testMobile);
      const [{ refreshToken }] = [
        await authService.loginWithPassword({ identifier: testMobile, password: 'original password' }),
      ];

      const code = '123456';
      const [row] = await db
        .insert(schema.passwordResetCodes)
        .values({ userId: user!.id, codeHash: hashResetCode(code), expiresAt: new Date(Date.now() + 60_000) })
        .returning();

      await authService.confirmPasswordReset({ identifier: testEmail, code, newPassword: 'brand new password' });

      // Old password no longer works, new one does.
      await expect(
        authService.loginWithPassword({ identifier: testMobile, password: 'original password' }),
      ).rejects.toThrow('Invalid mobile/email or password');
      await expect(
        authService.loginWithPassword({ identifier: testMobile, password: 'brand new password' }),
      ).resolves.toHaveProperty('accessToken');

      const [usedRow] = await db.select().from(schema.passwordResetCodes).where(eq(schema.passwordResetCodes.id, row!.id));
      expect(usedRow!.usedAt).not.toBeNull();

      // The refresh token from before the reset was revoked - refreshing with it now fails.
      await expect(authService.refresh(refreshToken)).rejects.toThrow('Invalid or expired refresh token');
    });

    it('rejects an incorrect code', async () => {
      await authService.register({
        name: 'Wrong Code Test',
        mobile: testMobile,
        email: testEmail,
        password: 'original password',
      });
      const user = await usersService.findByMobileOrEmail(testMobile);
      await db
        .insert(schema.passwordResetCodes)
        .values({ userId: user!.id, codeHash: hashResetCode('111111'), expiresAt: new Date(Date.now() + 60_000) });

      await expect(
        authService.confirmPasswordReset({ identifier: testEmail, code: '222222', newPassword: 'whatever123' }),
      ).rejects.toThrow('Invalid or expired code');
    });

    it('rejects an expired code', async () => {
      await authService.register({
        name: 'Expired Code Test',
        mobile: testMobile,
        email: testEmail,
        password: 'original password',
      });
      const user = await usersService.findByMobileOrEmail(testMobile);
      const code = '654321';
      await db
        .insert(schema.passwordResetCodes)
        .values({ userId: user!.id, codeHash: hashResetCode(code), expiresAt: new Date(Date.now() - 1000) });

      await expect(
        authService.confirmPasswordReset({ identifier: testEmail, code, newPassword: 'whatever123' }),
      ).rejects.toThrow('Invalid or expired code');
    });
  });
});
