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
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { SkipThrottle } from '@nestjs/throttler';
import type { Server, Socket } from 'socket.io';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { rides, type Ride } from '../db/schema';
import { DriversService } from '../drivers/drivers.service';
import { MetricsService } from '../metrics/metrics.service';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { RIDE_TRANSITIONS, type RideStatus } from '../rides/ride-state-machine';
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

/**
 * Connection-time ride-state snapshot, pushed to a socket the moment it finishes joining its
 * rooms (specification.md §8's "sync on reconnect" / §11.2's "clients reconnect and
 * resynchronize" - this is the WebSocket-side convenience on top of that guarantee, not a
 * replacement for it: `GET /rides/:id`/`GET /rides/history` remain the authoritative REST
 * fallback a client can always fall back to even if this push never arrives).
 *
 * Named distinctly from the `Ride*` transition-event names `events/consumers/
 * ride-event-routing.ts` defines (`RideAssigned`, `RideStarted`, ...), for the same reason
 * `DRIVER_LOCATION_UPDATED_EVENT` above didn't adopt that convention either (docs/open-items.md
 * #25/#26): those names are durable domain *transition* events flowing through the outbox, one
 * per state change, consumed exactly once each. `RideSync` is not a transition - it carries no
 * `eventType`, has no `ride_events`/`outbox_events` row behind it, and can fire redundantly
 * (e.g. a client that reconnects twice in a row gets it twice, each time reflecting whatever is
 * current at that instant) or not at all (idle connection, nothing active). Reusing a `Ride*`
 * name here would wrongly suggest it's one more entry in that same at-least-once transition
 * stream, when it is really closer to a "catalog page" a client can cheaply re-request.
 */
export const RIDE_SYNC_EVENT = 'RideSync';

/**
 * Lightweight snapshot payload for `RIDE_SYNC_EVENT` - identifiers + status only, matching the
 * "re-fetch full detail over REST if you need more" shape `DomainEventRealtimeConsumer`'s
 * `Ride*` payloads already use, not the full Drizzle row verbatim.
 */
export interface RideSyncPayload {
  rideId: string;
  status: RideStatus;
  driverId: string | null;
  vehicleId: string | null;
  pickupLatitude: number;
  pickupLongitude: number;
  pickupLocationName: string | null;
  destinationLatitude: number;
  destinationLongitude: number;
  destinationLocationName: string | null;
}

function toRideSyncPayload(ride: Ride): RideSyncPayload {
  return {
    rideId: ride.id,
    status: ride.status,
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
    pickupLatitude: ride.pickupLatitude,
    pickupLongitude: ride.pickupLongitude,
    pickupLocationName: ride.pickupLocationName,
    destinationLatitude: ride.destinationLatitude,
    destinationLongitude: ride.destinationLongitude,
    destinationLocationName: ride.destinationLocationName,
  };
}

/** The ride statuses during which a driver is actively engaged with a rider (rides/ride-state-machine.ts). */
const ACTIVE_RIDE_STATUSES: Ride['status'][] = [
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_PICKUP',
  'DRIVER_ARRIVED',
  'RIDE_STARTED',
  'DRIVER_EN_ROUTE_TO_DESTINATION',
];

/**
 * Terminal ride statuses, *derived* from `RIDE_TRANSITIONS` (rides/ride-state-machine.ts) rather
 * than hardcoded as a second, independently-maintained list - a status is terminal exactly when
 * it has no outgoing transitions. This yields `COMPLETED`/`CANCELLED_BY_USER`/
 * `CANCELLED_BY_DRIVER`/`CANCELLED_BY_SYSTEM`/`NO_DRIVER_AVAILABLE` today, but will stay correct
 * automatically if that table ever changes, instead of silently drifting out of sync with it.
 */
const TERMINAL_RIDE_STATUSES: RideStatus[] = (Object.keys(RIDE_TRANSITIONS) as RideStatus[]).filter(
  (status) => RIDE_TRANSITIONS[status].length === 0,
);

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
 *
 * `@SkipThrottle()` (docs/open-items.md, Phase 9 hardening/rate-limiting): the global
 * `ThrottlerGuard` (app.module.ts) is HTTP-request-shaped (it reads `req.ip`/`req.headers` off
 * `context.switchToHttp()`), and Nest's guard pipeline *does* run it against this gateway's own
 * `@SubscribeMessage('driver.location')` handler (unlike `handleConnection`/`handleDisconnect`,
 * which are plain lifecycle hooks Nest invokes directly, never through the guard pipeline, so
 * the connection handshake was never going to be touched by this guard either way - rate-
 * limiting *that* is explicitly out of scope for this task, see the WebSocket-auth-hardening
 * item below instead). Without this, every `driver.location` message would 500 inside the
 * guard itself (`req` is `undefined` in a WS execution context) rather than being usefully rate
 * limited - rate-limiting a high-frequency (3-15s cadence) authenticated GPS push stream is a
 * different problem from this task's actual target (unauthenticated HTTP brute-force), so it's
 * skipped outright rather than mis-applied.
 */
@SkipThrottle()
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
    private readonly metrics: MetricsService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const user = await authenticateSocket(client, this.jwtService);
    if (!user) {
      this.logger.warn(`Rejecting WebSocket connection: invalid/missing token (socket=${client.id})`);
      client.disconnect(true);
      return;
    }

    (client.data as SocketData).user = user;
    this.metrics.websocketConnections.inc();
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

    // Connection-time ride sync (specification.md §8/§11.2 - see RIDE_SYNC_EVENT's doc comment
    // above). Deliberately best-effort and last: a DB hiccup here must never make a client hang
    // on connect or lose its already-joined rooms, so any failure is logged and swallowed, same
    // pattern as the DRIVER-role room-join try/catch just above.
    try {
      await this.sendRideSync(user, (client.data as SocketData).driverId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send connection-time ${RIDE_SYNC_EVENT} to userId=${user.userId} (socket=${client.id}): ${message}`,
      );
    }
  }

  handleDisconnect(client: Socket): void {
    const user = (client.data as SocketData | undefined)?.user;
    if (user) {
      // Only decrement for a connection that was actually counted on the way in - a rejected
      // (never-authenticated) connection calls client.disconnect() itself before setting
      // client.data.user, so it never incremented the gauge in the first place.
      this.metrics.websocketConnections.dec();
    }
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
        // or forward a reading we just decided not to trust. Still counted, under its own
        // outcome label, so driver_location_updates_total reflects every push received, not
        // just the ones that passed the accuracy filter.
        this.metrics.driverLocationUpdatesTotal.inc({ outcome: 'rejected_low_accuracy' });
        return;
      }

      this.metrics.driverLocationUpdatesTotal.inc({ outcome: 'accepted' });

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

  /**
   * The rider's most recent non-terminal ride, if any - everything from `REQUESTED`/
   * `SEARCHING_DRIVER` through `DRIVER_EN_ROUTE_TO_DESTINATION` (i.e. not yet one of
   * `TERMINAL_RIDE_STATUSES`).
   *
   * The system does not currently enforce "at most one active ride per user" anywhere
   * (docs/open-items.md) - if more than one non-terminal ride turns up for this user, that gap
   * is logged here (not silently ignored) and the most recently *requested* one is used, since
   * that is the one a reconnecting client is overwhelmingly likely to actually care about.
   */
  private async findMostRecentNonTerminalRideForUser(userId: string): Promise<Ride | null> {
    const nonTerminalRides = await this.db
      .select()
      .from(rides)
      .where(and(eq(rides.userId, userId), notInArray(rides.status, TERMINAL_RIDE_STATUSES)))
      .orderBy(desc(rides.requestedAt));

    if (nonTerminalRides.length > 1) {
      this.logger.warn(
        `User ${userId} has ${nonTerminalRides.length} non-terminal rides at once (expected at ` +
          `most 1 - no DB/app-level constraint enforces this today, see docs/open-items.md); ` +
          `sending RideSync for the most recently requested one (${nonTerminalRides[0].id}).`,
      );
    }

    return nonTerminalRides[0] ?? null;
  }

  /**
   * Sends this connection its current-ride snapshot, if it has one (silence otherwise - no
   * "no active ride" push, consistent with how emitToUser/emitToDriver already treat an empty
   * room elsewhere in this gateway). A USER-role connection is checked against its rides, a
   * DRIVER-role connection (one that actually resolved a `drivers.id` above) against
   * `findActiveRideForDriver` - the same helper `handleDriverLocation` already uses, not a
   * second copy of "what counts as a driver's active ride".
   */
  private async sendRideSync(user: RequestUser, driverId: string | undefined): Promise<void> {
    if (user.role === 'DRIVER') {
      if (!driverId) {
        // No matching driver profile was resolved above (already logged there) - nothing to sync.
        return;
      }
      const ride = await this.findActiveRideForDriver(driverId);
      if (ride) {
        this.emitToDriver(driverId, RIDE_SYNC_EVENT, toRideSyncPayload(ride));
      }
      return;
    }

    const ride = await this.findMostRecentNonTerminalRideForUser(user.userId);
    if (ride) {
      this.emitToUser(user.userId, RIDE_SYNC_EVENT, toRideSyncPayload(ride));
    }
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
