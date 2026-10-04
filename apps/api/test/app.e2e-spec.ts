import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/db/drizzle.module';
import { FIREBASE_ADMIN } from '../src/auth/firebase/firebase-admin.provider';

/**
 * Bootstraps the app the same way main.ts does (global prefix + versioning +
 * validation pipe) so these tests exercise the REAL route paths a client hits.
 *
 * This exists specifically because of a production incident: the Admin app's API
 * client baseUrl and the backend's global prefix/versioning both contributed
 * "/api/v1", producing "/api/v1/api/v1/auth/login" - a 404 that nothing caught
 * before it reached production, because every test/manual check up to that point
 * either hit the backend directly with a hand-built path or only unit-tested
 * services in isolation. These tests assert on full *client-facing* paths.
 */
describe('App routing (e2e)', () => {
  let app: INestApplication;

  const mockDb = {
    execute: jest.fn().mockResolvedValue([{ ok: 1 }]),
  };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue(mockDb)
      .overrideProvider(FIREBASE_ADMIN)
      .useValue(null)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health endpoints are NOT behind /api (see main.ts setGlobalPrefix exclude)', () => {
    it('GET /health -> 200', async () => {
      await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    });

    it('GET /health/ready -> 200', async () => {
      await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ok' });
    });

    it('GET /api/health -> 404 (must not be double-prefixed)', async () => {
      await request(app.getHttpServer()).get('/api/health').expect(404);
    });
  });

  describe('versioned routes live at exactly /api/v1/... (regression: double-prefix bug)', () => {
    it('POST /api/v1/auth/login is reachable (not 404)', async () => {
      // FirebaseAuthGuard runs before body validation, and FIREBASE_ADMIN is mocked
      // null in this suite, so every call here short-circuits to 503 - the point of
      // this assertion is purely that the route resolves at all, not what guard/pipe
      // rejects it. See the dedicated 503 test below for that behavior specifically.
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({});
      expect(res.status).not.toBe(404);
    });

    it('POST /api/v1/api/v1/auth/login (double-prefixed) really is a 404', async () => {
      // Documents the exact bug: if a client ever reconstructs this path again,
      // this test's companion above (correct path) is the one that should pass.
      await request(app.getHttpServer()).post('/api/v1/api/v1/auth/login').send({}).expect(404);
    });

    it('GET /api/v1/vehicles without a token -> 401 (route exists, guard rejects)', async () => {
      await request(app.getHttpServer()).get('/api/v1/vehicles').expect(401);
    });

    it('GET /api/v1/drivers without a token -> 401 (route exists, guard rejects)', async () => {
      await request(app.getHttpServer()).get('/api/v1/drivers').expect(401);
    });

    it('GET /api/v1/campus/locations without a token -> 401 (route exists, guard rejects)', async () => {
      await request(app.getHttpServer()).get('/api/v1/campus/locations').expect(401);
    });

    it('GET /api/v1/campus/roads without a token -> 401 (route exists, guard rejects)', async () => {
      await request(app.getHttpServer()).get('/api/v1/campus/roads').expect(401);
    });

    it('GET /api/v1/campus/restricted-zones without a token -> 401 (route exists, guard rejects)', async () => {
      await request(app.getHttpServer()).get('/api/v1/campus/restricted-zones').expect(401);
    });
  });

  describe('auth/login with Firebase unconfigured', () => {
    it('returns 503, not a silent failure, when FIREBASE_ADMIN is null', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ idToken: 'at-least-ten-characters-long' })
        .expect(503);
    });
  });
});
