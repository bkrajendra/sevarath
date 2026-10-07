import 'reflect-metadata';
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { io, Socket as ClientSocket } from 'socket.io-client';
import type { Namespace } from 'socket.io';
import { AppModule } from '../src/app.module';
import { LocationGateway } from '../src/locations/location.gateway';
import * as schema from '../src/db/schema';
import { drivers, users } from '../src/db/schema';

/**
 * Real end-to-end proof that an authenticated WebSocket client lands in the right room(s)
 * (architecture.md §6.1) and that an unauthenticated one is rejected. Boots the full
 * `AppModule` against real Postgres/Redis (same pattern as `test/idempotency.e2e-spec.ts`),
 * but needs a real listening HTTP server - `app.listen(0)` - since `socket.io-client` opens
 * an actual socket, unlike supertest's in-memory HTTP usage elsewhere in this test suite.
 */
describe('LocationGateway (e2e, real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let gateway: LocationGateway;
  let baseUrl: string;

  let riderUserId: string;
  let riderToken: string;

  let driverUserId: string;
  let driverId: string;
  let driverToken: string;

  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_ACCESS_TTL ??= '15m';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL ??= '30d';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    const [rider] = await db
      .insert(users)
      .values({ name: 'WS Rider', mobile: `ws-rider-${Date.now()}` })
      .returning();
    riderUserId = rider.id;
    riderToken = jwt.sign({ sub: riderUserId, role: 'USER' }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
    });

    const [driverUser] = await db
      .insert(users)
      .values({ name: 'WS Driver', mobile: `ws-driver-${Date.now()}`, role: 'DRIVER' })
      .returning();
    driverUserId = driverUser.id;

    const [driver] = await db
      .insert(drivers)
      .values({ userId: driverUserId, driverCode: `WS-DRV-${Date.now()}` })
      .returning();
    driverId = driver.id;
    driverToken = jwt.sign({ sub: driverUserId, role: 'DRIVER' }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    gateway = app.get(LocationGateway);
  });

  afterEach(() => {
    for (const socket of openSockets) {
      socket.removeAllListeners();
      socket.close();
    }
    openSockets.length = 0;
  });

  afterAll(async () => {
    await db.delete(drivers).where(eq(drivers.id, driverId));
    await db.delete(users).where(eq(users.id, driverUserId));
    await db.delete(users).where(eq(users.id, riderUserId));
    await app.close();
    await pool.end();
  });

  function connect(token?: string): ClientSocket {
    const socket = io(`${baseUrl}/ws`, {
      ...(token === undefined ? {} : { auth: { token } }),
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    openSockets.push(socket);
    return socket;
  }

  // `LocationGateway`'s `@WebSocketServer() server` field is typed `Server` for its normal
  // `.to(room).emit(...)` fan-out usage, but at runtime - because the gateway declares a
  // `namespace` - Nest actually binds it to the `/ws` Namespace instance, whose `.sockets` is
  // a `Map<SocketId, Socket>` (one level shallower than `Server.sockets`, which is itself a
  // Namespace). Cast through `Namespace` here, test-only, to inspect real room membership.
  function getServerSocket(socketId: string) {
    const namespace = gateway['server'] as unknown as Namespace;
    return namespace.sockets.get(socketId);
  }

  function waitFor<T = unknown>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), 5000);
      socket.once(event, (value: T) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  /**
   * The client's 'connect' event only means the namespace handshake ack was sent - it says
   * nothing about whether `LocationGateway#handleConnection` (which runs asynchronously, with
   * its own DB round-trip for a DRIVER's room join) has finished yet. Poll instead of checking
   * once, so the assertion doesn't race the gateway's own async work.
   */
  async function waitForRoom(socketId: string, room: string, timeoutMs = 2000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (getServerSocket(socketId)?.rooms.has(room)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }

  it('accepts a valid rider token and joins the per-user room', async () => {
    const socket = connect(riderToken);
    await waitFor(socket, 'connect');

    expect(await waitForRoom(socket.id as string, `user:${riderUserId}`)).toBe(true);
    expect(getServerSocket(socket.id as string)!.rooms.has(`driver:${driverId}`)).toBe(false);
  });

  it('accepts a valid driver token and joins both the per-user and per-driver rooms', async () => {
    const socket = connect(driverToken);
    await waitFor(socket, 'connect');

    expect(await waitForRoom(socket.id as string, `user:${driverUserId}`)).toBe(true);
    expect(await waitForRoom(socket.id as string, `driver:${driverId}`)).toBe(true);
  });

  it('disconnects a connection with no token', async () => {
    const socket = connect(undefined);
    // Attach the 'disconnect' listener before awaiting 'connect': the server always sends
    // the connect ack before running handleConnection, but handleConnection's own disconnect
    // can follow within a few ms, so listening only starts after 'connect' resolves risks
    // missing a 'disconnect' that already fired.
    const disconnected = waitFor<string>(socket, 'disconnect');
    await waitFor(socket, 'connect');
    expect(await disconnected).toBe('io server disconnect');
  });

  it('disconnects a connection with an invalid token', async () => {
    const socket = connect('this-is-not-a-valid-jwt');
    const disconnected = waitFor<string>(socket, 'disconnect');
    await waitFor(socket, 'connect');
    expect(await disconnected).toBe('io server disconnect');
  });

  it('exposes emitToUser/emitToDriver that deliver only to their own room', async () => {
    const riderSocket = connect(riderToken);
    const driverSocket = connect(driverToken);
    await Promise.all([waitFor(riderSocket, 'connect'), waitFor(driverSocket, 'connect')]);
    await Promise.all([
      waitForRoom(riderSocket.id as string, `user:${riderUserId}`),
      waitForRoom(driverSocket.id as string, `driver:${driverId}`),
    ]);

    const riderReceived = new Promise((resolve) => riderSocket.once('ride.updated', resolve));
    const driverReceived = new Promise((resolve) => driverSocket.once('driver.status', resolve));

    gateway.emitToUser(riderUserId, 'ride.updated', { status: 'DRIVER_ASSIGNED' });
    gateway.emitToDriver(driverId, 'driver.status', { status: 'BUSY' });

    await expect(riderReceived).resolves.toEqual({ status: 'DRIVER_ASSIGNED' });
    await expect(driverReceived).resolves.toEqual({ status: 'BUSY' });
  });
});
