import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { drivers, rideEvents, rides, type Ride } from '../db/schema';
import { OutboxService } from '../events/outbox/outbox.service';
import { MetricsService } from '../metrics/metrics.service';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import {
  applyRideTransition,
  CANCELLABLE_RIDE_STATUSES,
  canTransition,
  TERMINAL_RIDE_STATUSES,
} from './ride-state-machine';
import type { CreateRideDto } from './dto/create-ride.dto';

@Injectable()
export class RidesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Creates a ride (status REQUESTED), writes its first ride_events row + outbox event, then
   * immediately transitions it to SEARCHING_DRIVER (also audited/outboxed) - all in one
   * transaction, so the ride never observably sits at REQUESTED.
   *
   * Rejects with a 409 if `userId` already has a non-terminal ride (docs/open-items.md #28):
   * nothing previously stopped a user ending up with two simultaneously-active rides. An
   * application-level check here (rather than a DB partial-unique-index constraint) was the
   * deliberate choice - it gives a clean, specific `ACTIVE_RIDE_ALREADY_EXISTS` error instead of
   * a generic unique-violation, and this system has no other place a second ride could be
   * created from (only this one endpoint ever inserts a `rides` row). This is a plain read
   * before the transaction starts, so it narrows but does not fully close the window: two
   * genuinely concurrent `POST /rides` calls for the same user (e.g. under two different
   * `Idempotency-Key`s - the idempotency mechanism itself only dedupes a *retried* request, not
   * two distinct ones) could both pass this check before either commits. Documented as an
   * accepted, narrow residual race rather than solved outright - closing it completely would
   * need the DB constraint this task chose not to add; see docs/open-items.md for the reasoning.
   */
  async create(userId: string, dto: CreateRideDto): Promise<Ride> {
    const [existingActiveRide] = await this.db
      .select({ id: rides.id, status: rides.status })
      .from(rides)
      .where(and(eq(rides.userId, userId), notInArray(rides.status, TERMINAL_RIDE_STATUSES)))
      .limit(1);

    if (existingActiveRide) {
      throw new ConflictException({
        code: 'ACTIVE_RIDE_ALREADY_EXISTS',
        message: `You already have an active ride (${existingActiveRide.id}, status ${existingActiveRide.status}) - cancel or complete it before requesting a new one.`,
        rideId: existingActiveRide.id,
      });
    }

    const ride = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(rides)
        .values({
          userId,
          pickupLatitude: dto.pickupLatitude,
          pickupLongitude: dto.pickupLongitude,
          pickupLocationName: dto.pickupLocationName ?? null,
          destinationLatitude: dto.destinationLatitude,
          destinationLongitude: dto.destinationLongitude,
          destinationLocationName: dto.destinationLocationName ?? null,
          status: 'REQUESTED',
        })
        .returning();

      await tx.insert(rideEvents).values({
        rideId: inserted.id,
        eventType: 'RideRequested',
        actorType: 'USER',
        actorId: userId,
      });

      await this.outboxService.record(tx, {
        eventType: 'RideRequested',
        aggregateType: 'ride',
        aggregateId: inserted.id,
        payload: {
          rideId: inserted.id,
          userId,
          pickup: { latitude: dto.pickupLatitude, longitude: dto.pickupLongitude },
          destination: { latitude: dto.destinationLatitude, longitude: dto.destinationLongitude },
        },
      });

      const searching = await applyRideTransition(tx, inserted.id, ['REQUESTED'], 'SEARCHING_DRIVER');

      await tx.insert(rideEvents).values({
        rideId: inserted.id,
        eventType: 'RideSearchingDriver',
        actorType: 'SYSTEM',
        actorId: null,
      });

      return searching;
    });

    this.metrics.rideRequestsTotal.inc();

    // In-process, same-process, fire-and-forget notification so a future Dispatch module can
    // start matching, WITHOUT RidesModule importing a DispatchModule that doesn't exist yet
    // (that would be circular once Dispatch needs to read ride state back via RidesService).
    // This is deliberately a *different* mechanism from the durable outbox_events/BullMQ
    // pipeline above: EventEmitter2 is in-memory and lost on process restart/crash, used only
    // to decouple this module's business logic (triggering dispatch) from a sibling module;
    // the outbox is for durable, at-least-once delivery to things outside this process
    // (WebSocket gateway, notifications, later phases). Do not conflate the two.
    //
    // NOTE: nothing listens for 'ride.requested' yet - see docs/open-items.md. Until a future
    // Dispatch module adds an @OnEvent('ride.requested') listener, rides emitted here will sit
    // in SEARCHING_DRIVER forever (the ride row itself is still correct/durable; only the
    // "someone should start matching drivers" trigger is unconsumed).
    this.eventEmitter.emit('ride.requested', {
      rideId: ride.id,
      userId,
      pickup: { latitude: dto.pickupLatitude, longitude: dto.pickupLongitude },
      destination: { latitude: dto.destinationLatitude, longitude: dto.destinationLongitude },
    });

    return ride;
  }

  async findById(id: string, requester: RequestUser): Promise<Ride> {
    const ride = await this.getRideOrThrow(id);
    await this.assertCanView(ride, requester);
    return ride;
  }

  async findHistoryForUser(userId: string): Promise<Ride[]> {
    return this.db.select().from(rides).where(eq(rides.userId, userId)).orderBy(desc(rides.requestedAt));
  }

  /**
   * Cancels a ride on behalf of the riding user or the currently-assigned driver (never an
   * arbitrary driver). Only permitted from a cancellable state (specification.md §5's
   * cancellable-states list - up to and including DRIVER_ARRIVED).
   *
   * NOTE (see docs/open-items.md): specification.md §8 describes "Driver cancels -> ride
   * returns to dispatch / SEARCHING_DRIVER" (re-offer without the rider re-requesting). This
   * method implements the simpler terminal CANCELLED_BY_DRIVER transition instead - real
   * re-dispatch needs the Dispatch module (to re-run matching excluding the cancelling driver),
   * which doesn't exist yet.
   */
  async cancel(id: string, requester: RequestUser, reason?: string): Promise<Ride> {
    const ride = await this.getRideOrThrow(id);
    await this.assertCanView(ride, requester);

    if (!CANCELLABLE_RIDE_STATUSES.includes(ride.status)) {
      throw new BadRequestException({
        code: 'RIDE_NOT_CANCELLABLE',
        message: `Ride cannot be cancelled from status ${ride.status}`,
      });
    }

    const toStatus = requester.role === 'DRIVER' ? 'CANCELLED_BY_DRIVER' : 'CANCELLED_BY_USER';
    if (!canTransition(ride.status, toStatus)) {
      throw new BadRequestException({
        code: 'RIDE_NOT_CANCELLABLE',
        message: `Ride cannot be cancelled from status ${ride.status}`,
      });
    }

    const updated = await this.db.transaction(async (tx) => {
      const result = await applyRideTransition(tx, id, CANCELLABLE_RIDE_STATUSES, toStatus, {}, 'RIDE_NOT_CANCELLABLE');

      await tx.insert(rideEvents).values({
        rideId: id,
        eventType: 'RideCancelled',
        actorType: requester.role === 'DRIVER' ? 'DRIVER' : 'USER',
        actorId: requester.userId,
        metadata: reason ? { reason } : null,
      });

      await this.outboxService.record(tx, {
        eventType: 'RideCancelled',
        aggregateType: 'ride',
        aggregateId: id,
        payload: { rideId: id, cancelledBy: toStatus, reason: reason ?? null },
      });

      return result;
    });

    this.metrics.rideCancelledTotal.inc({ cancelled_by: toStatus.replace('CANCELLED_BY_', '') });

    // Same in-process/outbox distinction as the 'ride.requested' emit in create() above: this
    // lets the Dispatch module release the driver/vehicle back to AVAILABLE without RidesModule
    // importing DispatchModule. Only fired when a driver was actually assigned - a ride
    // cancelled before SEARCHING_DRIVER resolved has nothing to release.
    if (updated.driverId) {
      this.eventEmitter.emit('ride.cancelled', { rideId: id, driverId: updated.driverId });
    }

    return updated;
  }

  /**
   * Driver marks themselves arrived at pickup. Must be the ride's assigned driver.
   *
   * NOTE (see docs/open-items.md): accepts fromStatuses ['DRIVER_ASSIGNED',
   * 'DRIVER_EN_ROUTE_TO_PICKUP'] - this phase has no endpoint that transitions a ride into
   * DRIVER_EN_ROUTE_TO_PICKUP (no "depart to pickup" action in scope), so arriving straight
   * from DRIVER_ASSIGNED must also work, or every ride would be stuck.
   */
  async markArrived(id: string, driverId: string): Promise<Ride> {
    await this.assertAssignedDriver(id, driverId);
    return this.transitionAsDriver(
      id,
      driverId,
      ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_PICKUP'],
      'DRIVER_ARRIVED',
      'DriverArrived',
    );
  }

  /** Driver starts the ride. Must be the ride's assigned driver. */
  async start(id: string, driverId: string): Promise<Ride> {
    await this.assertAssignedDriver(id, driverId);
    return this.transitionAsDriver(id, driverId, ['DRIVER_ARRIVED'], 'RIDE_STARTED', 'RideStarted');
  }

  /**
   * Driver completes the ride.
   *
   * NOTE (see docs/open-items.md): accepts fromStatuses ['RIDE_STARTED',
   * 'DRIVER_EN_ROUTE_TO_DESTINATION'] because nothing populates DRIVER_EN_ROUTE_TO_DESTINATION
   * yet in this phase (a Phase 5/6 location concern) - completing straight from RIDE_STARTED
   * must work today.
   */
  async complete(id: string, driverId: string): Promise<Ride> {
    await this.assertAssignedDriver(id, driverId);
    const updated = await this.transitionAsDriver(
      id,
      driverId,
      ['RIDE_STARTED', 'DRIVER_EN_ROUTE_TO_DESTINATION'],
      'COMPLETED',
      'RideCompleted',
    );

    this.metrics.rideCompletedTotal.inc();

    // Same in-process/outbox distinction as the 'ride.requested' emit in create() above - lets
    // the Dispatch module release the driver/vehicle back to AVAILABLE without RidesModule
    // importing DispatchModule.
    this.eventEmitter.emit('ride.completed', { rideId: id, driverId });

    return updated;
  }

  private async transitionAsDriver(
    id: string,
    driverId: string,
    fromStatuses: Ride['status'][],
    toStatus: Ride['status'],
    eventType: string,
  ): Promise<Ride> {
    return this.db.transaction(async (tx) => {
      const updated = await applyRideTransition(tx, id, fromStatuses, toStatus);

      await tx.insert(rideEvents).values({
        rideId: id,
        eventType,
        actorType: 'DRIVER',
        actorId: driverId,
      });

      await this.outboxService.record(tx, {
        eventType,
        aggregateType: 'ride',
        aggregateId: id,
        payload: { rideId: id, driverId },
      });

      return updated;
    });
  }

  private async getRideOrThrow(id: string): Promise<Ride> {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, id));
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  /** Throws NotFoundException/ForbiddenException unless `driverId` is the ride's assigned driver. */
  private async assertAssignedDriver(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.getRideOrThrow(rideId);
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('You are not the assigned driver for this ride');
    }
    return ride;
  }

  /**
   * Authorizes a view/cancel of `ride` for `requester`: the riding user, the assigned driver
   * (resolved via the drivers table - rides.driverId references drivers.id, not users.id), or
   * an ADMIN/OPERATOR.
   */
  private async assertCanView(ride: Ride, requester: RequestUser): Promise<void> {
    if (requester.role === 'ADMIN' || requester.role === 'OPERATOR') {
      return;
    }

    if (ride.userId === requester.userId) {
      return;
    }

    if (requester.role === 'DRIVER' && ride.driverId) {
      const [driver] = await this.db.select().from(drivers).where(eq(drivers.id, ride.driverId));
      if (driver && driver.userId === requester.userId) {
        return;
      }
    }

    throw new ForbiddenException('You do not have access to this ride');
  }
}
