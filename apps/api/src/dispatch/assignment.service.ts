import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { drivers, rideEvents, rideOffers, vehicles, type Ride } from '../db/schema';
import { OutboxService } from '../events/outbox/outbox.service';
import { MetricsService } from '../metrics/metrics.service';
import { applyRideTransition } from '../rides/ride-state-machine';
import { DispatchService } from './dispatch.service';

/**
 * Accept/reject logic for the driver's live offer - the concurrency-critical part of
 * architecture.md §4.2/§9. See the module-level comment in dispatch.service.ts for the rest of
 * the cascade.
 */
@Injectable()
export class AssignmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly outboxService: OutboxService,
    private readonly dispatchService: DispatchService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Driver accepts their live offer. Three conditional updates inside one transaction, each
   * checked for an affected row, with the whole transaction rolled back if any fails:
   *
   *   (a) the ride: SEARCHING_DRIVER -> DRIVER_ASSIGNED (via applyRideTransition - already
   *       throws RideTransitionConflictException/RIDE_ALREADY_ASSIGNED for a zero-row update)
   *   (b) the driver: AVAILABLE -> BUSY, conditioned on still being AVAILABLE
   *   (c) the vehicle: AVAILABLE -> IN_SERVICE, conditioned on still being AVAILABLE
   *
   * (b) and (c) exist because nothing else stops the SAME driver from being offered - and
   * accepting - two different rides concurrently if two dispatch cascades raced; claiming the
   * driver/vehicle row itself is what makes that impossible.
   */
  async accept(rideId: string, driverId: string): Promise<Ride> {
    const pendingOffer = await this.findPendingOffer(rideId, driverId);
    if (!pendingOffer) {
      throw new BadRequestException({ code: 'NO_PENDING_OFFER' });
    }

    const ride = await this.db.transaction(async (tx) => {
      const [driver] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      if (!driver) {
        throw new BadRequestException({ code: 'DRIVER_NOT_FOUND' });
      }
      const vehicleId = driver.currentVehicleId;
      if (!vehicleId) {
        throw new BadRequestException({ code: 'DRIVER_HAS_NO_VEHICLE' });
      }

      // (a) The ride itself - the single authoritative "this driver won" check.
      const updatedRide = await applyRideTransition(
        tx,
        rideId,
        ['SEARCHING_DRIVER'],
        'DRIVER_ASSIGNED',
        { driverId, vehicleId },
        'RIDE_ALREADY_ASSIGNED',
      );

      // (b) Conditionally claim the driver.
      const [claimedDriver] = await tx
        .update(drivers)
        .set({ availability: 'BUSY', updatedAt: new Date() })
        .where(and(eq(drivers.id, driverId), eq(drivers.availability, 'AVAILABLE')))
        .returning();
      if (!claimedDriver) {
        throw new ConflictException({ code: 'DRIVER_NOT_AVAILABLE' });
      }

      // (c) Conditionally claim the vehicle.
      const [claimedVehicle] = await tx
        .update(vehicles)
        .set({ status: 'IN_SERVICE', updatedAt: new Date() })
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.status, 'AVAILABLE')))
        .returning();
      if (!claimedVehicle) {
        throw new ConflictException({ code: 'VEHICLE_NOT_AVAILABLE' });
      }

      // Conditioned on result still being PENDING, not just id: findPendingOffer ran before this
      // transaction opened, so the 15s timeout processor could have raced in and marked this
      // same offer EXPIRED in the gap - without this guard we'd silently overwrite that back to
      // ACCEPTED and let an already-timed-out driver win the ride. Mirrors the same
      // conditional-update pattern as the driver/vehicle claims above and the timeout
      // processor's own `result = 'PENDING'` guard (ride-offer-timeout.processor.ts).
      const [claimedOffer] = await tx
        .update(rideOffers)
        .set({ result: 'ACCEPTED', respondedAt: new Date() })
        .where(and(eq(rideOffers.id, pendingOffer.id), eq(rideOffers.result, 'PENDING')))
        .returning();
      if (!claimedOffer) {
        throw new ConflictException({ code: 'OFFER_NO_LONGER_PENDING' });
      }

      await tx.insert(rideEvents).values({
        rideId,
        eventType: 'RideAssigned',
        actorType: 'DRIVER',
        actorId: driverId,
      });

      await this.outboxService.record(tx, {
        eventType: 'RideAssigned',
        aggregateType: 'ride',
        aggregateId: rideId,
        payload: { rideId, driverId, vehicleId },
      });

      return updatedRide;
    });

    // ride_assignment_duration_seconds (architecture.md §10): time from SEARCHING_DRIVER to
    // DRIVER_ASSIGNED, computed straight from the ride's own requestedAt/acceptedAt columns -
    // applyRideTransition above stamps acceptedAt the instant this transition commits, so no
    // separate clock/timer is needed.
    if (ride.acceptedAt) {
      this.metrics.rideAssignmentDurationSeconds.observe(
        (ride.acceptedAt.getTime() - ride.requestedAt.getTime()) / 1000,
      );
    }

    return ride;
  }

  /**
   * Driver rejects their live offer. The ride stays SEARCHING_DRIVER - only the offer row
   * changes - then the cascade advances to the next nearest candidate, excluding every driver
   * already offered this ride (this one included).
   */
  async reject(rideId: string, driverId: string): Promise<void> {
    const pendingOffer = await this.findPendingOffer(rideId, driverId);
    if (!pendingOffer) {
      throw new BadRequestException({ code: 'NO_PENDING_OFFER' });
    }

    const rejected = await this.db.transaction(async (tx) => {
      // Same TOCTOU guard as accept() above: findPendingOffer ran before this transaction
      // opened, so the 15s timeout could have raced in and already marked this offer EXPIRED
      // (and started its own advanceToNextDriver) in the gap. Without conditioning on
      // result = 'PENDING' here, we could both "win": overwrite EXPIRED back to REJECTED and
      // then call advanceToNextDriver a second time, double-offering the next candidate.
      const [claimedOffer] = await tx
        .update(rideOffers)
        .set({ result: 'REJECTED', respondedAt: new Date() })
        .where(and(eq(rideOffers.id, pendingOffer.id), eq(rideOffers.result, 'PENDING')))
        .returning();

      if (!claimedOffer) {
        return false;
      }

      await tx.insert(rideEvents).values({
        rideId,
        eventType: 'RideOfferRejected',
        actorType: 'DRIVER',
        actorId: driverId,
      });

      return true;
    });

    if (!rejected) {
      // The timeout processor beat us to it - it already called advanceToNextDriver itself.
      return;
    }

    const excludeDriverIds = await this.dispatchService.listOfferedDriverIds(rideId);
    await this.dispatchService.advanceToNextDriver(rideId, excludeDriverIds);
  }

  private async findPendingOffer(rideId: string, driverId: string) {
    const [offer] = await this.db
      .select()
      .from(rideOffers)
      .where(
        and(eq(rideOffers.rideId, rideId), eq(rideOffers.driverId, driverId), eq(rideOffers.result, 'PENDING')),
      );
    return offer;
  }
}
