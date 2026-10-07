import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { and, eq, inArray } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { rides, type Ride } from '../db/schema';
import { DriversService } from '../drivers/drivers.service';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { authenticateSocket } from './ws-jwt.guard';
import { LocationCacheService } from './location-cache.service';

/**
 * Per-connection data this gateway attaches to `client.data` once authenticated.
 * `Socket.data` is typed `any` by socket.io itself (no generics are threaded through Nest's
 * gateway decorators here), so this is a cast-time shape, not a module augmentation.
 *
 * `driverId` (the connected user's `drivers.id`, resolved once at connection time for a
 * DRIVER-role socket) is cached here so the high-frequency `driver.location` handler below
 * never has to re-query `DriversService.findByUserId` on every single GPS ping (these can
 * arrive every 3-15s per specification.md §6 - re-resolving per message would be wasteful DB
 * load for no reason, `handleConnection` already did this lookup once).
 */
interface SocketData {
  user?: RequestUser;
  driverId?: string;
}

/**
 * Inbound event name a driver's app pushes a GPS fix on, and outbound event name a rider's
 * socket receives it under. These are picked here, not by the eventType-string convention
 * `events/consumers/domain-event-realtime.consumer.ts` established for durable outbox events
 * (docs/open-items.md #25) - this path never touches the outbox (architecture.md's "high-
 * frequency GPS updates should be treated separately" guidance), so there is no eventType
 * string to reuse or stay consistent with. `'driver.location'` (inbound) mirrors the
 * lowercase-dot illustrative style architecture.md §6.1 uses for WS event names in general;
 * `'DriverLocationUpdated'` (outbound) mirrons the PascalCase the ride-event consumer actually
 * emits, since this is the event name a rider's client sees alongside those same `Ride*`
 * events on the same socket - consistency with its neighbors on the wire mattered more here
 * than consistency with its own inbound counterpart's naming style.
 */
export const DRIVER_LOCATION_PUSH_EVENT = 'driver.location';
export const DRIVER_LOCATION_UPDATED_EVENT = 'DriverLocationUpdated';

/** The ride statuses during which a driver is actively engaged with a rider (rides/ride-state-machine.ts). */
const ACTIVE_RIDE_STATUSES: Ride['status'][] = [
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_PICKUP',
  'DRIVER_ARRIVED',
  'RIDE_STARTED',
  'DRIVER_EN_ROUTE_TO_DESTINATION',
];

/** Payload shape a driver's app sends on `driver.location` (specification.md §6's field list). */
export interface DriverLocationPushPayload {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Runtime validation - this is a WS message body, never passed through Nest's HTTP `ValidationPipe`. */
function isValidLocationPushPayload(payload: unknown): payload is DriverLocationPushPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (!isFiniteNumber(candidate.latitude) || !isFiniteNumber(candidate.longitude)) {
    return false;
  }
  for (const optionalField of ['heading', 'speed', 'accuracy'] as const) {
    const value = candidate[optionalField];
    if (value !== undefined && !isFiniteNumber(value)) {
      return false;
    }
  }
  return true;
}

/** Room a single authenticated user (rider or driver) can always be reached on. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Room a driver's own `drivers.id` (not `users.id`) can be reached on. */
export function driverRoom(driverId: string): string {
  return `driver:${driverId}`;
}

/**
 * Real-time location/ride-event gateway, namespace `/ws` (architecture.md §6.1).
 *
 * This gateway is deliberately domain-agnostic: it only knows *who* is allowed to receive
 * what's addressed to them (per-user and per-driver rooms), never *what* gets sent. Wiring
 * actual `ride.*`/`driver.location` business events into it (consuming the `domain-events`
 * BullMQ queue - see docs/open-items.md #3) is a separate, already-planned follow-up task.
 *
 * CORS is left permissive (`origin: true, credentials: true`), mirroring `main.ts`'s existing
 * posture - this is pre-production/internal; tighten to an explicit origin allowlist before
 * any public-facing deployment.
 */
@Injectable()
@WebSocketGateway({ namespace: '/ws', cors: { origin: true, credentials: true } })
export class LocationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LocationGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly driversService: DriversService,
    private readonly locationCache: LocationCacheService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const user = await authenticateSocket(client, this.jwtService);
    if (!user) {
      this.logger.warn(`Rejecting WebSocket connection: invalid/missing token (socket=${client.id})`);
      client.disconnect(true);
      return;
    }

    (client.data as SocketData).user = user;
    await client.join(userRoom(user.userId));

    if (user.role === 'DRIVER') {
      try {
        const driver = await this.driversService.findByUserId(user.userId);
        await client.join(driverRoom(driver.id));
        (client.data as SocketData).driverId = driver.id;
      } catch (error) {
        // A JWT claiming role=DRIVER with no matching driver profile shouldn't normally
        // happen (stale/malformed token), but it isn't a reason to refuse the connection
        // outright - the client still gets its own user:<userId> room.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Connected user ${user.userId} claims role=DRIVER but has no driver profile ` +
            `(socket=${client.id}): ${message}`,
        );
      }
    }

    this.logger.log(
      `WebSocket connected: socket=${client.id} userId=${user.userId} role=${user.role}`,
    );
  }

  handleDisconnect(client: Socket): void {
    const user = (client.data as SocketData | undefined)?.user;
    this.logger.log(
      `WebSocket disconnected: socket=${client.id}` +
        (user ? ` userId=${user.userId} role=${user.role}` : ' (unauthenticated)'),
    );
  }

  /**
   * Handles a driver's live GPS push (specification.md §6). Deliberately separate from the
   * durable `outbox_events`/BullMQ `ride.*` pipeline (architecture.md: "Location updates do
   * not necessarily need to go through the durable domain-event pipeline. Treat high-frequency
   * GPS updates separately.") - this is a direct, best-effort, in-process path: cache in
   * Redis, dual-write the DB snapshot dispatch still reads (open-items.md #2), and forward live
   * to whichever rider currently has this driver on an active ride, if any.
   *
   * Never crashes the connection - every rejection path below is a logged no-op, not a thrown
   * error, since a malformed/unauthorized message on an otherwise-fine socket shouldn't cost
   * the driver their connection.
   */
  @SubscribeMessage(DRIVER_LOCATION_PUSH_EVENT)
  async handleDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const data = client.data as SocketData;
    const user = data.user;
    const driverId = data.driverId;

    if (user?.role !== 'DRIVER' || !driverId) {
      this.logger.warn(
        `Rejecting '${DRIVER_LOCATION_PUSH_EVENT}' push from socket=${client.id}: not an ` +
          `authenticated driver connection (role=${user?.role ?? 'none'}, driverId=${driverId ?? 'none'})`,
      );
      return;
    }

    if (!isValidLocationPushPayload(payload)) {
      this.logger.warn(
        `Rejecting malformed '${DRIVER_LOCATION_PUSH_EVENT}' payload from driver=${driverId} (socket=${client.id})`,
      );
      return;
    }

    try {
      const { latitude, longitude, heading, speed, accuracy } = payload;
      const recordedAt = new Date().toISOString();

      const result = await this.locationCache.trySetLocation(driverId, {
        latitude,
        longitude,
        heading,
        speed,
        accuracy,
        recordedAt,
      });
      if (!result.accepted) {
        // Low-quality fix dropped (LocationCacheService already logged why) - don't dual-write
        // or forward a reading we just decided not to trust.
        return;
      }

      // Dual-write (open-items.md #2): keep the existing DB snapshot fresh too. Dispatch
      // matching (driver-matcher.service.ts) and the accept flow (assignment.service.ts) still
      // read this column - this task adds the Redis path alongside it, it doesn't replace it.
      try {
        await this.driversService.updateLocationForUser(user.userId, latitude, longitude);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to persist DB location snapshot for driver=${driverId}: ${message}`);
      }

      const activeRide = await this.findActiveRideForDriver(driverId);
      if (!activeRide) {
        // A driver can be AVAILABLE/idle with no active ride - normal, not an error.
        return;
      }

      this.emitToUser(activeRide.userId, DRIVER_LOCATION_UPDATED_EVENT, {
        rideId: activeRide.id,
        driverId,
        latitude,
        longitude,
        heading,
        speed,
        recordedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Unexpected error handling '${DRIVER_LOCATION_PUSH_EVENT}' from driver=${driverId}: ${message}`,
      );
    }
  }

  /** The driver's currently active ride (rides/ride-state-machine.ts's "actively happening" statuses), if any. */
  private async findActiveRideForDriver(driverId: string): Promise<Ride | null> {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(and(eq(rides.driverId, driverId), inArray(rides.status, ACTIVE_RIDE_STATUSES)));
    return ride ?? null;
  }

  /** Sends `event` with `payload` to every live connection for this user (rider or driver). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /** Sends `event` with `payload` to every live connection for this driver's own `drivers.id`. */
  emitToDriver(driverId: string, event: string, payload: unknown): void {
    this.server.to(driverRoom(driverId)).emit(event, payload);
  }
}
