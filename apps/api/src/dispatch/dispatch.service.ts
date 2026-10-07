import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { drivers, rideEvents, rideOffers, rides, vehicles, type Ride } from '../db/schema';
import { OutboxService } from '../events/outbox/outbox.service';
import { applyRideTransition } from '../rides/ride-state-machine';
import { DriverMatcherService, type PickupPoint } from './driver-matcher.service';
import { OFFER_RESPONSE_WINDOW_MS, RIDE_OFFER_TIMEOUT_JOB, RIDE_OFFER_TIMEOUT_QUEUE } from './dispatch.constants';

export interface RideRequestedPayload {
  rideId: string;
  userId: string;
  pickup: PickupPoint;
  destination: { latitude: number; longitude: number };
}

export interface RideReleasePayload {
  rideId: string;
  driverId: string;
}

/**
 * Starts and drives the nearest-driver offer cascade for a ride (architecture.md §4.2).
 *
 * Closes docs/open-items.md #9 (flagged blocking): the @OnEvent('ride.requested') handler below
 * is the listener that was missing - rides.service.ts#create's 'ride.requested' emit now has a
 * consumer that actually kicks off matching.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly outboxService: OutboxService,
    private readonly driverMatcher: DriverMatcherService,
    @InjectQueue(RIDE_OFFER_TIMEOUT_QUEUE) private readonly timeoutQueue: Queue,
  ) {}

  @OnEvent('ride.requested')
  async onRideRequested(payload: RideRequestedPayload): Promise<void> {
    try {
      await this.startCascade(payload.rideId, payload.pickup);
    } catch (error) {
      // A listener throwing must never crash the emitting request (ride creation already
      // committed) - log and let a later timeout/manual retry path recover, same spirit as the
      // outbox publisher's own try/catch around each row.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start dispatch cascade for ride ${payload.rideId}: ${message}`);
    }
  }

  @OnEvent('ride.completed')
  async onRideCompleted(payload: RideReleasePayload): Promise<void> {
    await this.releaseDriverAndVehicle(payload.rideId, payload.driverId);
  }

  @OnEvent('ride.cancelled')
  async onRideCancelled(payload: RideReleasePayload): Promise<void> {
    await this.releaseDriverAndVehicle(payload.rideId, payload.driverId);
  }

  /** First offer of the cascade for a freshly SEARCHING_DRIVER ride - excludes nobody yet. */
  private async startCascade(rideId: string, pickup: PickupPoint): Promise<void> {
    const candidates = await this.driverMatcher.findCandidates(pickup, []);
    if (candidates.length === 0) {
      await this.markNoDriverAvailable(rideId);
      return;
    }

    await this.offerToDriver(rideId, candidates[0].id);
  }

  /**
   * Shared re-offer logic used both when nobody responded in time (timeout processor) and when
   * a driver explicitly rejects (assignment.service). Re-runs matching excluding every driver
   * already offered for this ride, and either offers the next nearest candidate or exhausts to
   * NO_DRIVER_AVAILABLE.
   */
  async advanceToNextDriver(rideId: string, excludeDriverIds: string[]): Promise<void> {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, rideId));
    if (!ride) {
      this.logger.warn(`advanceToNextDriver: ride ${rideId} not found`);
      return;
    }

    // The cascade only makes sense while the ride is still SEARCHING_DRIVER - if it has already
    // moved on (assigned, cancelled, etc.) there is nothing to advance.
    if (ride.status !== 'SEARCHING_DRIVER') {
      return;
    }

    const candidates = await this.driverMatcher.findCandidates(
      { latitude: ride.pickupLatitude, longitude: ride.pickupLongitude },
      excludeDriverIds,
    );

    if (candidates.length === 0) {
      await this.markNoDriverAvailable(rideId);
      return;
    }

    await this.offerToDriver(rideId, candidates[0].id);
  }

  /** All driver ids that have ever been offered this ride (PENDING, ACCEPTED, REJECTED or EXPIRED). */
  async listOfferedDriverIds(rideId: string): Promise<string[]> {
    const rows = await this.db
      .select({ driverId: rideOffers.driverId })
      .from(rideOffers)
      .where(eq(rideOffers.rideId, rideId));
    return rows.map((r) => r.driverId);
  }

  /**
   * Creates the ride_offers row for `driverId`, writes the audit trail + outbox event, and
   * schedules the 15s timeout job. Factored into one helper so neither the @OnEvent handler nor
   * advanceToNextDriver duplicate this sequence.
   */
  private async offerToDriver(rideId: string, driverId: string): Promise<void> {
    const offerId = await this.db.transaction(async (tx) => {
      const [offer] = await tx
        .insert(rideOffers)
        .values({ rideId, driverId, result: 'PENDING' })
        .returning();

      await tx.insert(rideEvents).values({
        rideId,
        eventType: 'RideDriverNotified',
        actorType: 'SYSTEM',
        actorId: null,
        metadata: { driverId },
      });

      // NOTE: there is no WebSocket gateway yet (Phase 5). This outbox event is the "driver
      // should receive a notification" trigger, but today nothing consumes it toward the
      // driver app - the driver app's only way to discover this offer is the polling endpoint
      // GET /api/v1/dispatch/offers/me (dispatch.controller.ts).
      await this.outboxService.record(tx, {
        eventType: 'RideDriverNotified',
        aggregateType: 'ride',
        aggregateId: rideId,
        payload: { rideId, driverId },
      });

      return offer.id;
    });

    await this.timeoutQueue.add(
      RIDE_OFFER_TIMEOUT_JOB,
      { offerId, rideId, driverId },
      { delay: OFFER_RESPONSE_WINDOW_MS },
    );
  }

  private async markNoDriverAvailable(rideId: string): Promise<Ride | undefined> {
    return this.db.transaction(async (tx) => {
      let updated: Ride;
      try {
        updated = await applyRideTransition(tx, rideId, ['SEARCHING_DRIVER'], 'NO_DRIVER_AVAILABLE');
      } catch {
        // Ride already left SEARCHING_DRIVER (e.g. assigned or cancelled concurrently) -
        // nothing to do.
        return undefined;
      }

      await tx.insert(rideEvents).values({
        rideId,
        eventType: 'RideNoDriverAvailable',
        actorType: 'SYSTEM',
        actorId: null,
      });

      await this.outboxService.record(tx, {
        eventType: 'RideNoDriverAvailable',
        aggregateType: 'ride',
        aggregateId: rideId,
        payload: { rideId },
      });

      return updated;
    });
  }

  /**
   * Releases a ride's driver/vehicle back to AVAILABLE once the ride ends (completed or
   * cancelled). No conditional-claim semantics needed here (unlike assignment.service's accept
   * path) - there's no race to lose on release, just a plain UPDATE.
   */
  private async releaseDriverAndVehicle(rideId: string, driverId: string): Promise<void> {
    try {
      const [ride] = await this.db.select().from(rides).where(eq(rides.id, rideId));
      const [driver] = await this.db.select().from(drivers).where(eq(drivers.id, driverId));
      const vehicleId = ride?.vehicleId ?? driver?.currentVehicleId ?? null;

      await this.db
        .update(drivers)
        .set({ availability: 'AVAILABLE', updatedAt: new Date() })
        .where(eq(drivers.id, driverId));

      if (vehicleId) {
        await this.db
          .update(vehicles)
          .set({ status: 'AVAILABLE', updatedAt: new Date() })
          .where(eq(vehicles.id, vehicleId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to release driver ${driverId} for ride ${rideId}: ${message}`);
    }
  }
}
