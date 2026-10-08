import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import * as schema from '../src/db/schema';
import { refreshTokens, users } from '../src/db/schema';

/**
 * Phase 9 ("Hardening") refresh-token rotation + revocation - against the real local Postgres
 * (not mocked), real `AppModule`, real HTTP via supertest, same convention as
 * `test/device-tokens.e2e-spec.ts`. Covers the behaviors docs/open-items.md's rotation rows
 * call out: a normal rotation invalidates the token it replaced, presenting an
 * already-rotated-away token is detected as reuse and revokes every other active session for
 * that user too, `/auth/logout` revokes on demand, and logout is idempotent on an
 * already-invalid token.
 *
 * Register/login-password are both under `auth.controller.ts`'s stricter 5/min
 * `AUTH_BRUTE_FORCE_THROTTLE` (own counter per handler - see `test/rate-limit.e2e-spec.ts`'s own
 * comment on that), so this suite deliberately keeps its total register calls to 1 and its
 * total login/password calls to 2, both well under that limit, and does every other
 * token-lifecycle step (refresh/logout) through handlers left at the global 100/min default.
 */
describe('Auth refresh-token rotation + revocation (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  // register's mobile field is validated against /^\+?[1-9]\d{7,14}$/ (register.dto.ts) - must
  // be numeric, unlike e.g. device-tokens.e2e-spec.ts's raw-DB-inserted test users, which skip
  // that validation entirely by writing rows directly.
  const mobile = `+9${Date.now()}`;
  const password = 'correct horse battery staple';
  let userId: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live', 'metrics'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await app.close();
    await pool.end();
  });

  it('registers a user and records a refresh_tokens row for the issued refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Auth Refresh E2E', mobile, password })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    userId = res.body.userId;

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
    // The stored value must be a hash, never the raw token.
    expect(rows[0].tokenHash).not.toBe(res.body.refreshToken);
  });

  it('(a) rotates on refresh: the new refresh token works, and the OLD one is rejected if reused', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login/password')
      .send({ identifier: mobile, password })
      .expect(200);
    const originalRefreshToken: string = registerRes.body.refreshToken;

    const rotateRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(200);
    const rotatedRefreshToken: string = rotateRes.body.refreshToken;
    expect(rotatedRefreshToken).not.toBe(originalRefreshToken);

    // The new token works for a further refresh.
    const secondRotateRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(200);
    expect(secondRotateRes.body.refreshToken).toBeDefined();

    // Reusing the original (now-rotated-away) token is rejected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(401);
  });

  it('(b) reuse detection revokes every active session for the user, not just the reused chain', async () => {
    // Session 1: register's original tokens were already consumed by test (a)'s rotations
    // above - issue a fresh independent session via login/password instead.
    const session1Login = await request(app.getHttpServer())
      .post('/api/v1/auth/login/password')
      .send({ identifier: mobile, password })
      .expect(200);
    const session1Original: string = session1Login.body.refreshToken;

    // Rotate session 1 once, so session1Original becomes a revoked/already-rotated-away token
    // and session1Current is the live one.
    const session1Rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session1Original })
      .expect(200);
    const session1Current: string = session1Rotated.body.refreshToken;

    // Session 2: a second, fully independent active session for the SAME user.
    const session2Login = await request(app.getHttpServer())
      .post('/api/v1/auth/login/password')
      .send({ identifier: mobile, password })
      .expect(200);
    const session2Current: string = session2Login.body.refreshToken;

    // session2Current is deliberately left untouched by its own owner here - it must still be
    // independently live going into the reuse trigger below, so that its subsequent rejection
    // can only be explained by the cross-user revocation, not by its own rotation.
    // Trigger reuse by presenting session1's OLD, already-rotated-away token.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session1Original })
      .expect(401);

    // Reuse detection must have revoked every row for this user - session1Current (the chain's
    // own live token) and session2's live token are both now dead too.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session1Current })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session2Current })
      .expect(401);

    const activeRows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    expect(activeRows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('(c) POST /auth/logout revokes the given token; a subsequent refresh with it fails', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login/password')
      .send({ identifier: mobile, password })
      .expect(200);
    const refreshToken: string = loginRes.body.refreshToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('(d) POST /auth/logout on an already-invalid/unknown token still returns success, not an error', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'totally-unknown-and-malformed-token-value' })
      .expect(204);
  });
});
