import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import * as schema from '../src/db/schema';
import { users } from '../src/db/schema';

/**
 * GET /api/v1/users (Phase 8 - this resource's own collection endpoint, ADMIN-only per
 * specification.md §2, deliberately NOT OPERATOR - see docs/open-items.md and
 * users.controller.ts's doc comment). Own isolation prefix: `users-list-e2e-` mobiles, per the
 * established docs/open-items.md #12/#18/#25/#26/#30 convention - this suite seeds no
 * drivers/vehicles/rides, so no coordinate island is needed.
 */
describe('GET /api/v1/users (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seededUserIds: string[] = [];

  async function makeUser(
    label: string,
    overrides: Partial<schema.NewUser> = {},
  ): Promise<schema.User> {
    const [user] = await db
      .insert(users)
      .values({
        name: overrides.name ?? `Users List E2E ${label}`,
        mobile: overrides.mobile ?? `users-list-e2e-${label}-${suffix}`,
        email: overrides.email,
        role: overrides.role ?? 'USER',
      })
      .returning();
    seededUserIds.push(user.id);
    return user;
  }

  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const adminUser = await makeUser('admin', { role: 'ADMIN' });
    adminToken = jwt.sign({ sub: adminUser.id, role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const operatorUser = await makeUser('operator', { role: 'OPERATOR' });
    operatorToken = jwt.sign({ sub: operatorUser.id, role: 'OPERATOR' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, seededUserIds));
    }
    await app.close();
    await pool.end();
  });

  it('filters by role, scoped to our own seeded mobiles via search', async () => {
    const searchToken = `plain-${suffix}`;
    await makeUser('driver-role', { role: 'DRIVER', mobile: `users-list-e2e-${searchToken}-driver` });
    await makeUser('plain-1', { role: 'USER', mobile: `users-list-e2e-${searchToken}-1` });
    await makeUser('plain-2', { role: 'USER', mobile: `users-list-e2e-${searchToken}-2` });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ role: 'USER', search: searchToken })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) {
      expect(item.role).toBe('USER');
    }
  });

  /**
   * Regression test: review of this task's hand-off found that users.controller.ts was
   * returning the raw `users` row/array from both this endpoint and GET /users/me - never
   * mapped through UserResponseDto at runtime (it only existed for Swagger's @ApiOkResponse
   * metadata; this codebase has no global ClassSerializerInterceptor). That leaked every
   * caller's bcrypt passwordHash (and firebaseUid) to any ADMIN hitting this list. Fixed by
   * explicitly mapping to the safe field set in the controller - this test proves it stays
   * fixed.
   */
  it('never returns passwordHash or firebaseUid, even though the DB row carries both', async () => {
    const seeded = await makeUser('secret-fields', {
      mobile: `users-list-e2e-secret-fields-${suffix}`,
    });
    await db.update(users).set({ passwordHash: 'bcrypt-hash-should-never-leave-the-server' }).where(
      inArray(users.id, [seeded.id]),
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ search: `secret-fields-${suffix}` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    const [item] = res.body.items;
    expect(item).not.toHaveProperty('passwordHash');
    expect(item).not.toHaveProperty('firebaseUid');
    expect(Object.keys(item).sort()).toEqual(
      ['createdAt', 'email', 'id', 'mobile', 'name', 'role', 'status', 'updatedAt'].sort(),
    );
  });

  it('filters by free-text search against name/mobile/email (case-insensitive)', async () => {
    const unique = `findme-${suffix}`;
    const target = await makeUser('search-target', {
      name: `Searchable ${unique}`,
      mobile: `users-list-e2e-search-${suffix}`,
      email: `${unique}@example.com`,
    });

    const byName = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ search: unique.toUpperCase() })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byName.body.items.map((u: { id: string }) => u.id)).toContain(target.id);

    const byEmail = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ search: `${unique}@EXAMPLE.com` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byEmail.body.items.map((u: { id: string }) => u.id)).toContain(target.id);
  });

  it('paginates with limit/offset', async () => {
    const label = `page-${suffix}`;
    await makeUser(`${label}-1`, { mobile: `users-list-e2e-${label}-1` });
    await makeUser(`${label}-2`, { mobile: `users-list-e2e-${label}-2` });
    await makeUser(`${label}-3`, { mobile: `users-list-e2e-${label}-3` });

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ search: label, limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(3);

    const page2 = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ search: label, limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
  });

  it('rejects an OPERATOR-role caller with 403 (unlike the admin/ dashboard/rides/live-map endpoints)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('rejects a USER-role caller with 403', async () => {
    const plainUser = await makeUser('plain-caller');
    const plainToken = jwt.sign({ sub: plainUser.id, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403);
  });

  it('allows an ADMIN caller through (sanity check for the preceding 403s)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
