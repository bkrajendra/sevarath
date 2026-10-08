import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Phase 9 ("Hardening") rate limiting - see docs/open-items.md. Boots the real `AppModule`
 * (real `ThrottlerModule.forRoot`/global `APP_GUARD`, same as a real deployment - the
 * in-memory `ThrottlerStorageService` is per-`app.init()` instance, so this suite's counts
 * never leak into or out of any other test file) and exercises it purely over real HTTP via
 * supertest, same convention as every other e2e suite here. No Postgres rows are seeded (the
 * endpoints exercised below reject before ever reaching the DB - bad credentials / no auth
 * header), so there is no isolation-prefix/cleanup concern either.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live', 'metrics'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * auth.controller.ts's AUTH_BRUTE_FORCE_THROTTLE overrides the global default down to
   * 5 requests/minute specifically on login/login-password/register. Each of the first 5 calls
   * should still reach the real handler (and fail with the normal 401 "bad credentials" - the
   * throttler doesn't care about the handler's own outcome, it counts every request that
   * reaches the guard), and the 6th, within the same 60s window, must be rejected by the guard
   * itself with 429 - never reaching AuthService at all.
   */
  it('POST /api/v1/auth/login/password returns 429 after exceeding its 5/min limit', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login/password')
        .send({ identifier: 'rate-limit-e2e-nonexistent-user', password: 'wrong-password' });

    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      // Not the point of this test (no such user exists), but confirms these 5 genuinely
      // reached the real handler rather than being rejected by something else first.
      expect(res.status).toBe(401);
    }

    const sixth = await attempt();
    expect(sixth.status).toBe(429);
  });

  /**
   * Same stricter throttle applies independently to POST /auth/register - confirms the limit
   * is per-handler (both configured via the same AUTH_BRUTE_FORCE_THROTTLE constant, but
   * @Throttle's metadata/keying is per class+handler, see @nestjs/throttler's generateKey), not
   * accidentally shared/conflated with login/password's own counter above.
   */
  it('POST /api/v1/auth/register returns 429 after exceeding its 5/min limit', async () => {
    const attempt = (n: number) =>
      request(app.getHttpServer()).post('/api/v1/auth/register').send({
        name: 'Rate Limit E2E',
        mobile: `+9199999000${n}`,
        password: 'short', // fails validation (min 8 chars) - still counted by the guard,
        // which runs before Nest's ValidationPipe.
      });

    for (let i = 0; i < 5; i++) {
      const res = await attempt(i);
      expect(res.status).toBe(400);
    }

    const sixth = await attempt(5);
    expect(sixth.status).toBe(429);
  });

  /**
   * A normal endpoint under only the global default (100/min) must not false-positive at a
   * reasonable call volume - 20 rapid, genuinely sequential calls (well under 100) all reach
   * the real guard chain (401, no Authorization header - JwtAuthGuard rejects before any DB
   * access) with no 429 anywhere in the run.
   */
  it('a normal endpoint under the global default does not false-positive at reasonable volume', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer()).get('/api/v1/vehicles');
      expect(res.status).toBe(401);
    }
  });

  /**
   * GET /auth/refresh is deliberately left at the global default, not the stricter
   * AUTH_BRUTE_FORCE_THROTTLE (see auth.controller.ts's doc comment) - a handful of calls in a
   * row (well under 100/min) must not be rejected the way login/register's 6th call above is.
   */
  it('POST /api/v1/auth/refresh stays at the global default, not the stricter auth limit', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' });
      expect(res.status).not.toBe(429);
    }
  });
});
