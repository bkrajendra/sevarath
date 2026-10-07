import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DriversService } from '../drivers/drivers.service';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { authenticateSocket } from './ws-jwt.guard';

/**
 * Per-connection data this gateway attaches to `client.data` once authenticated.
 * `Socket.data` is typed `any` by socket.io itself (no generics are threaded through Nest's
 * gateway decorators here), so this is a cast-time shape, not a module augmentation.
 */
interface SocketData {
  user?: RequestUser;
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

  /** Sends `event` with `payload` to every live connection for this user (rider or driver). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /** Sends `event` with `payload` to every live connection for this driver's own `drivers.id`. */
  emitToDriver(driverId: string, event: string, payload: unknown): void {
    this.server.to(driverRoom(driverId)).emit(event, payload);
  }
}
