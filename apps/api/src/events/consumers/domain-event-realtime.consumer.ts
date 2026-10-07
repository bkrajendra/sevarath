import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { rides, type Ride } from '../../db/schema';
import { LocationGateway } from '../../locations/location.gateway';
import { DOMAIN_EVENTS_QUEUE } from '../outbox.constants';
import type { DomainEventJob } from '../publisher/outbox-publisher.service';
import { RIDE_EVENT_ROUTING, type RideEventRecipient } from './ride-event-routing';

/**
 * Consumes the `domain-events` BullMQ queue (architecture.md §4.3) and forwards each ride event
 * to the right WebSocket room(s) via `LocationGateway`, per the routing table in
 * `ride-event-routing.ts`. Closes docs/open-items.md #3 and #22.
 *
 * No retry config here, matching `ride-offer-timeout.processor.ts`'s own queue (no special
 * `attempts`) for consistency - see docs/open-items.md if that default is ever revisited.
 */
@Injectable()
@Processor(DOMAIN_EVENTS_QUEUE)
export class DomainEventRealtimeConsumer extends WorkerHost {
  private readonly logger = new Logger(DomainEventRealtimeConsumer.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly locationGateway: LocationGateway,
  ) {
    super();
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    const { aggregateType, aggregateId, eventType, payload } = job.data;

    // Future-proofing only: every outbox event today has aggregateType 'ride' (the only
    // callers are rides.service.ts/dispatch.service.ts/assignment.service.ts, all ride-scoped -
    // see docs/open-items.md's briefing for this task). Don't assume that stays true forever;
    // a future non-ride aggregate type should silently no-op here, not get misrouted as a ride.
    if (aggregateType !== 'ride') {
      return;
    }

    const recipients = RIDE_EVENT_ROUTING[eventType];
    if (recipients === undefined) {
      this.logger.warn(
        `No real-time routing registered for eventType "${eventType}" (ride ${aggregateId}) - dropping.`,
      );
      return;
    }
    if (recipients.length === 0) {
      return;
    }

    // Real errors below (e.g. a DB connection failure) are allowed to propagate/throw rather
    // than being swallowed - WebSocket delivery is "best-effort" per architecture.md, but a
    // thrown error at least surfaces in logs/BullMQ's own failure tracking instead of vanishing
    // silently. Only the "ride not found" case is treated as a deliberate, logged no-op (a
    // genuinely expected race, not an error - see docs/open-items.md's cleanup-retry precedent
    // in the dispatch/booking e2e suites).
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, aggregateId));
    if (!ride) {
      this.logger.warn(
        `No ride found for aggregateId=${aggregateId} (eventType=${eventType}) - skipping delivery.`,
      );
      return;
    }

    // Keep the WebSocket payload lightweight - an identifier + status plus the outbox event's
    // own fields, never the full `rides` row (booking spec §8: the client re-fetches the
    // authoritative booking over REST if it needs more).
    const wsPayload = { rideId: aggregateId, status: ride.status, ...payload };

    for (const recipient of recipients) {
      this.deliverTo(recipient, eventType, wsPayload, ride, payload);
    }
  }

  private deliverTo(
    recipient: RideEventRecipient,
    eventType: string,
    wsPayload: Record<string, unknown>,
    ride: Ride,
    payload: Record<string, unknown>,
  ): void {
    switch (recipient) {
      case 'rider':
        this.locationGateway.emitToUser(ride.userId, eventType, wsPayload);
        return;
      case 'assignedDriver':
        // May be null (e.g. RideCancelled before any driver was ever assigned) - a no-op, not
        // an error.
        if (ride.driverId) {
          this.locationGateway.emitToDriver(ride.driverId, eventType, wsPayload);
        }
        return;
      case 'offeredDriver': {
        const offeredDriverId = payload.driverId;
        if (typeof offeredDriverId === 'string' && offeredDriverId.length > 0) {
          this.locationGateway.emitToDriver(offeredDriverId, eventType, wsPayload);
        } else {
          this.logger.warn(
            `eventType "${eventType}" (ride ${ride.id}) routes to 'offeredDriver' but payload has no ` +
              'driverId - dropping for this recipient.',
          );
        }
        return;
      }
    }
  }
}
