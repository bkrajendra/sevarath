import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { io, Socket as ClientSocket } from 'socket.io-client';
import type { Namespace } from 'socket.io';
import { AppModule } from '../src/app.module';
import { LocationGateway, DRIVER_LOCATION_UPDATED_EVENT } from '../src/locations/location.gateway';
import { LocationCacheService } from '../src/locations/location-cache.service';
import * as schema from '../src/db/schema';
import { drivers, rides, users, vehicles } from '../src/db/schema';

/**
 * Real end-to-end proof of the live driver-location push pipeline (docs/plan.md Phase 5,
 * docs/open-items.md's "Real-Time Location" task): a driver pushes a `driver.location`
 * WebSocket message, it's cached in Redis (real round-trip, not mocked), and - when that
 * driver has an active ride - forwarded live to the rider's own socket as
 * `DriverLocationUpdated`, entirely outside the durable outbox/BullMQ `ride.*` pipeline that
 * `test/realtime-ride-events.e2e-spec.ts` already covers.
 *
 * Rides are seeded directly (not driven through the real dispatch cascade like
 * `realtime-ride-events.e2e-spec.ts` does) - simpler and just as faithful for proving this
 * specific pipeline, which only cares about `rides.driverId`/`rides.status`, not how a ride
 * got there. Own isolated pickup coordinate island, (65.0, 65.0), per the established
 * docs/open-items.md #12/#18/#25 pattern, even though no query here actually searches by
 * distance - keeps this suite's seeded rows unambiguously distinct from every other suite's.
 */
describe('Driver location push pipeline (e2e, real Postgres + Redis + WebSocket)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let gateway: LocationGateway;
  let locationCache: LocationCacheService;
  let baseUrl: string;

  let riderId: string;
  let riderToken: string;

  let activeDriverUserId: string;
  let activeDriverId: string;
  let activeDriverToken: string;
  let vehicleId: string;
  let rideId: string;

  let idleDriverUserId: string;
  let idleDriverId: string;
  let idleDriverToken: string;

  const openSockets: ClientSocket[] = [];
  const pickup = { latitude: 65.0, longitude: 65.0 };
  const destination = { latitude: 65.01, longitude: 65.01 };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [rider] = await db
      .insert(users)
      .values({ name: 'DriverLoc E2E Rider', mobile: `driverloc-e2e-rider-${suffix}` })
      .returning();
    riderId = rider.id;
    riderToken = jwt.sign({ sub: riderId, role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [vehicle] = await db
      .insert(vehicles)
      .values({ vehicleCode: `DRIVERLOC-E2E-${suffix}`, status: 'IN_SERVICE' })
      .returning();
    vehicleId = vehicle.id;

    const [activeDriverUser] = await db
      .insert(users)
      .values({ name: 'DriverLoc E2E Active Driver', mobile: `driverloc-e2e-drv-${suffix}`, role: 'DRIVER' })
      .returning();
    activeDriverUserId = activeDriverUser.id;
    activeDriverToken = jwt.sign({ sub: activeDriverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [activeDriver] = await db
      .insert(drivers)
      .values({
        userId: activeDriverUserId,
        driverCode: `DRIVERLOC-E2E-ACTIVE-${suffix}`,
        status: 'ACTIVE',
        availability: 'BUSY',
        currentVehicleId: vehicleId,
      })
      .returning();
    activeDriverId = activeDriver.id;

    const [ride] = await db
      .insert(rides)
      .values({
        userId: riderId,
        driverId: activeDriverId,
        vehicleId,
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
        status: 'DRIVER_ASSIGNED',
      })
      .returning();
    rideId = ride.id;

    const [idleDriverUser] = await db
      .insert(users)
      .values({ name: 'DriverLoc E2E Idle Driver', mobile: `driverloc-e2e-idle-${suffix}`, role: 'DRIVER' })
      .returning();
    idleDriverUserId = idleDriverUser.id;
    idleDriverToken = jwt.sign({ sub: idleDriverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });

    const [idleDriver] = await db
      .insert(drivers)
      .values({
        userId: idleDriverUserId,
        driverCode: `DRIVERLOC-E2E-IDLE-${suffix}`,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
      })
      .returning();
    idleDriverId = idleDriver.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // A real listening HTTP server is needed - socket.io-client opens an actual socket, same
    // reasoning as test/location-gateway.e2e-spec.ts.
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    gateway = app.get(LocationGateway);
    locationCache = app.get(LocationCacheService);
  });

  afterEach(() => {
    for (const socket of openSockets) {
      socket.removeAllListeners();
      socket.close();
    }
    openSockets.length = 0;
  });

  afterAll(async () => {
    await db.delete(rides).where(inArray(rides.id, [rideId]));
    await db.delete(drivers).where(inArray(drivers.id, [activeDriverId, idleDriverId]));
    await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
    await db
      .delete(users)
      .where(inArray(users.id, [riderId, activeDriverUserId, idleDriverUserId]));
    await app.close();
    await pool.end();
  });

  function connect(token: string): ClientSocket {
    const socket = io(`${baseUrl}/ws`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    openSockets.push(socket);
    return socket;
  }

  function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
      socket.once(event, (value: T) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  // Same cast-through-Namespace reasoning as test/location-gateway.e2e-spec.ts's
  // `getServerSocket` - `LocationGateway['server']` is actually the `/ws` Namespace at runtime.
  function getServerSocket(socketId: string) {
    const namespace = gateway['server'] as unknown as Namespace;
    return namespace.sockets.get(socketId);
  }

  /** Polls until the gateway has finished `handleConnection`'s own async DB-driven room join. */
  async function waitForDriverRoomJoin(socketId: string, driverId: string, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (getServerSocket(socketId)?.rooms.has(`driver:${driverId}`)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`driver ${driverId} never joined its room within ${timeoutMs}ms`);
  }

  it(
    "forwards a driver's push to the rider on their active ride, and really caches it in Redis",
    async () => {
      const riderSocket = connect(riderToken);
      const driverSocket = connect(activeDriverToken);
      await Promise.all([waitFor(riderSocket, 'connect'), waitFor(driverSocket, 'connect')]);
      await waitForDriverRoomJoin(driverSocket.id as string, activeDriverId);

      const riderReceived = waitFor<{
        rideId: string;
        driverId: string;
        latitude: number;
        longitude: number;
        heading?: number;
        speed?: number;
        recordedAt: string;
      }>(riderSocket, DRIVER_LOCATION_UPDATED_EVENT);

      driverSocket.emit('driver.location', {
        latitude: 65.002,
        longitude: 65.003,
        heading: 90,
        speed: 5.5,
        accuracy: 12,
      });

      const event = await riderReceived;
      expect(event.rideId).toBe(rideId);
      expect(event.driverId).toBe(activeDriverId);
      expect(event.latitude).toBe(65.002);
      expect(event.longitude).toBe(65.003);
      expect(event.heading).toBe(90);
      expect(event.speed).toBe(5.5);
      expect(typeof event.recordedAt).toBe('string');

      // Real Redis round-trip, via the one service that knows the key format - not a mock.
      const cached = await locationCache.getLocation(activeDriverId);
      expect(cached).not.toBeNull();
      expect(cached!.latitude).toBe(65.002);
      expect(cached!.longitude).toBe(65.003);
      expect(cached!.accuracy).toBe(12);
    },
    10000,
  );

  it(
    'does not throw when a driver with no active ride pushes a location update',
    async () => {
      const driverSocket = connect(idleDriverToken);
      await waitFor(driverSocket, 'connect');
      await waitForDriverRoomJoin(driverSocket.id as string, idleDriverId);

      const stayedConnected = new Promise<boolean>((resolve) => {
        driverSocket.once('disconnect', () => resolve(false));
        setTimeout(() => resolve(true), 500);
      });

      driverSocket.emit('driver.location', { latitude: 65.5, longitude: 65.5 });

      expect(await stayedConnected).toBe(true);

      // It still gets cached, even with nobody to forward it to - caching is unconditional.
      const cached = await locationCache.getLocation(idleDriverId);
      expect(cached).not.toBeNull();
      expect(cached!.latitude).toBe(65.5);
    },
    5000,
  );
});
