import { Injectable, Logger, Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { rideEvents, rideOffers } from '../db/schema';
import { DispatchService } from './dispatch.service';
import { RIDE_OFFER_TIMEOUT_QUEUE } from './dispatch.constants';

export interface RideOfferTimeoutJobData {
  offerId: string;
  rideId: string;
  driverId: string;
}

/**
 * Fires ~15s after a ride_offers row is created (dispatch.service.ts#offerToDriver). No-ops if
 * the driver already responded (ACCEPTED/REJECTED) in the meantime - the conditional UPDATE
 * below (`result = 'PENDING'`) is what makes that check race-safe, not a separate read-then-write.
 */
@Injectable()
@Processor(RIDE_OFFER_TIMEOUT_QUEUE)
export class RideOfferTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(RideOfferTimeoutProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly dispatchService: DispatchService,
  ) {
    super();
  }

  async process(job: Job<RideOfferTimeoutJobData>): Promise<void> {
    const { offerId, rideId, driverId } = job.data;

    const [expired] = await this.db
      .update(rideOffers)
      .set({ result: 'EXPIRED', respondedAt: new Date() })
      .where(and(eq(rideOffers.id, offerId), eq(rideOffers.result, 'PENDING')))
      .returning();

    if (!expired) {
      // Already ACCEPTED or REJECTED - a real response beat the timeout. Nothing to do.
      return;
    }

    await this.db.insert(rideEvents).values({
      rideId,
      eventType: 'RideOfferExpired',
      actorType: 'SYSTEM',
      actorId: null,
      metadata: { driverId },
    });

    const excludeDriverIds = await this.dispatchService.listOfferedDriverIds(rideId);

    try {
      await this.dispatchService.advanceToNextDriver(rideId, excludeDriverIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to advance dispatch cascade for ride ${rideId}: ${message}`);
    }
  }
}
