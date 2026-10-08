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
import { deviceTokens, users } from '../src/db/schema';

/**
 * Phase 7 ("Notifications") device-token registration endpoint, against the real local
 * Postgres (not mocked) - the specific behavior under test is the upsert-by-`token` decision in
 * `device-tokens.ts`'s/`DeviceTokensService#register`'s doc comments: re-registering the same
 * token (a) for the same user just refreshes it, and (b) for a *different* user reassigns it
 * rather than erroring on the unique constraint - see docs/open-items.md.
 */
describe('Device token registration (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let userAId: string;
  let userAToken: string;
  let userBId: string;
  let userBToken: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [userA] = await db
      .insert(users)
      .values({ name: 'DeviceToken E2E User A', mobile: `devicetoken-e2e-a-${suffix}`, role: 'USER' })
      .returning();
    userAId = userA.id;
    userAToken = jwt.sign({ sub: userAId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });

    const [userB] = await db
      .insert(users)
      .values({ name: 'DeviceToken E2E User B', mobile: `devicetoken-e2e-b-${suffix}`, role: 'USER' })
      .returning();
    userBId = userB.id;
    userBToken = jwt.sign({ sub: userBId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await db.delete(deviceTokens).where(inArray(deviceTokens.userId, [userAId, userBId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
    await app.close();
    await pool.end();
  });

  it('registers a new device token for the calling user', async () => {
    const token = `devicetoken-e2e-${Date.now()}-register`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'ANDROID' })
      .expect(201);

    expect(res.body).toMatchObject({ userId: userAId, platform: 'ANDROID' });

    const [row] = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token));
    expect(row).toBeDefined();
    expect(row.userId).toBe(userAId);
  });

  /**
   * Regression test (this task's leak audit, docs/open-items.md): the response body must never
   * echo back the literal FCM registration `token` - the caller already has it (they just sent
   * it), so there's no legitimate reason to put it back on the wire, and this is the same leak
   * class as #45 (`users.controller.ts`'s `passwordHash`/`firebaseUid`).
   */
  it('never returns the raw token in the response body', async () => {
    const token = `devicetoken-e2e-${Date.now()}-no-token-leak`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'ANDROID' })
      .expect(201);

    expect(res.body).not.toHaveProperty('token');
    expect(Object.keys(res.body).sort()).toEqual(
      ['createdAt', 'id', 'platform', 'updatedAt', 'userId'].sort(),
    );
  });

  it('re-registering the same token for the same user upserts (updates platform) rather than duplicating', async () => {
    const token = `devicetoken-e2e-${Date.now()}-reregister`;

    await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'ANDROID' })
      .expect(201);

    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'IOS' })
      .expect(201);

    expect(secondRes.body.platform).toBe('IOS');

    const rows = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token));
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('IOS');
    expect(rows[0].userId).toBe(userAId);
  });

  it('re-registering an existing token under a different user reassigns it rather than erroring', async () => {
    const token = `devicetoken-e2e-${Date.now()}-reassign`;

    await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'ANDROID' })
      .expect(201);

    // User B now registers the exact same physical-device token (e.g. the device was handed
    // off / resold, or A logged out and B logged in on it) - must succeed, not 409/500.
    const reassignRes = await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ token, platform: 'IOS' })
      .expect(201);

    expect(reassignRes.body).toMatchObject({ userId: userBId, platform: 'IOS' });

    const rows = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userBId);
    expect(rows[0].platform).toBe('IOS');
  });

  it('rejects an unauthenticated registration attempt', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .send({ token: 'no-auth-token', platform: 'ANDROID' })
      .expect(401);
  });

  it('unregisters the calling user\'s own token', async () => {
    const token = `devicetoken-e2e-${Date.now()}-unregister`;

    await request(app.getHttpServer())
      .post('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token, platform: 'ANDROID' })
      .expect(201);

    await request(app.getHttpServer())
      .delete('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ token })
      .expect(204);

    const rows = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token));
    expect(rows).toHaveLength(0);
  });
});
