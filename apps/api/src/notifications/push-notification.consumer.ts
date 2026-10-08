import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as admin from 'firebase-admin';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { deviceTokens, drivers, rides, type Ride } from '../db/schema';
import { FIREBASE_ADMIN } from '../auth/firebase/firebase-admin.provider';
import { NOTIFICATION_EVENTS_QUEUE } from '../events/outbox.constants';
import { MetricsService } from '../metrics/metrics.service';
import type { DomainEventJob } from '../events/publisher/outbox-publisher.service';
import { resolvePushRecipients } from './push-recipients';
import { buildNotificationCopy } from './push-notification-copy';
import type { RideEventRecipient } from '../events/consumers/ride-event-routing';

/**
 * Consumes the `notification-events` BullMQ queue (the second leg of the Phase 4 outbox
 * publisher's fan-out, alongside `DomainEventRealtimeConsumer` on `domain-events` - see
 * docs/open-items.md) and sends a push notification via FCM for the ride events that warrant
 * one (`push-recipients.ts`).
 *
 * No real push can ever actually send in this sandbox - there is no real Firebase project
 * configured here (`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` are all
 * empty in `.env`), so `FIREBASE_ADMIN` resolves to `null` and every send is logged-and-skipped
 * below. This is verified by unit/integration tests that mock `FIREBASE_ADMIN`, never against a
 * real device - see docs/open-items.md.
 */
@Injectable()
@Processor(NOTIFICATION_EVENTS_QUEUE)
export class PushNotificationConsumer extends WorkerHost {
  private readonly logger = new Logger(PushNotificationConsumer.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App | null,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    const { aggregateType, aggregateId, eventType, payload } = job.data;

    // Same future-proofing as DomainEventRealtimeConsumer - every outbox event today is
    // ride-scoped; a future non-ride aggregate type should silently no-op here.
    if (aggregateType !== 'ride') {
      return;
    }

    const recipients = resolvePushRecipients(eventType, payload);
    if (recipients.length === 0) {
      return;
    }

    const [ride] = await this.db.select().from(rides).where(eq(rides.id, aggregateId));
    if (!ride) {
      this.logger.warn(
        `No ride found for aggregateId=${aggregateId} (eventType=${eventType}) - skipping push.`,
      );
      return;
    }

    for (const recipient of recipients) {
      const copy = buildNotificationCopy(eventType, recipient);
      if (!copy) {
        // Routed to a recipient but no copy defined for this eventType - shouldn't happen given
        // how push-recipients.ts/push-notification-copy.ts are kept in lockstep, but fail safe
        // rather than sending a blank notification.
        this.logger.warn(`No notification copy for eventType "${eventType}" - skipping.`);
        continue;
      }

      const userId = await this.resolveUserId(recipient, ride, payload);
      if (!userId) {
        continue;
      }

      await this.sendToUser(userId, eventType, ride, copy);
    }
  }

  /** Maps a routing-table recipient role to the actual `users.id` to notify. */
  private async resolveUserId(
    recipient: RideEventRecipient,
    ride: Ride,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    switch (recipient) {
      case 'rider':
        return ride.userId;
      case 'assignedDriver': {
        // May be null (e.g. cancelled before any driver was ever assigned) - a no-op, not an
        // error, same as DomainEventRealtimeConsumer's handling of this same case.
        if (!ride.driverId) {
          return null;
        }
        return this.driverIdToUserId(ride.driverId);
      }
      case 'offeredDriver': {
        const offeredDriverId = payload.driverId;
        if (typeof offeredDriverId !== 'string' || offeredDriverId.length === 0) {
          this.logger.warn(
            `Push recipient 'offeredDriver' for ride ${ride.id} but payload has no driverId - skipping.`,
          );
          return null;
        }
        return this.driverIdToUserId(offeredDriverId);
      }
    }
  }

  /** `rides.driverId`/`ride_offers.driverId` are `drivers.id`, not `users.id` - one extra hop
   *  to reach the `device_tokens.userId` a driver's push is actually keyed on. */
  private async driverIdToUserId(driverId: string): Promise<string | null> {
    const [driver] = await this.db.select().from(drivers).where(eq(drivers.id, driverId));
    if (!driver) {
      this.logger.warn(`No driver found for driverId=${driverId} - skipping push.`);
      return null;
    }
    return driver.userId;
  }

  private async sendToUser(
    userId: string,
    eventType: string,
    ride: Ride,
    copy: { title: string; body: string },
  ): Promise<void> {
    const tokens = await this.db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
    if (tokens.length === 0) {
      // The normal case for most users in this sandbox (no mobile client registers a real FCM
      // token here) - not an error.
      this.logger.debug(`No device tokens registered for user ${userId} - skipping push for ${eventType}.`);
      this.metrics.pushNotificationsTotal.inc({ outcome: 'skipped_no_token' });
      return;
    }

    if (!this.firebaseApp) {
      // Logged once per attempt (per recipient/event), not once per token - see class doc
      // comment: there is no real Firebase project in this sandbox, so this is the expected
      // path every time a push would otherwise have gone out.
      this.logger.warn(
        `FIREBASE_ADMIN is not configured - skipping push delivery for ${eventType} to user ${userId} ` +
          `(${tokens.length} token(s) registered).`,
      );
      this.metrics.pushNotificationsTotal.inc({ outcome: 'skipped_not_configured' });
      return;
    }

    const messaging = admin.messaging(this.firebaseApp);

    for (const deviceToken of tokens) {
      try {
        await messaging.send({
          token: deviceToken.token,
          notification: { title: copy.title, body: copy.body },
          data: { rideId: ride.id, eventType },
        });
        this.metrics.pushNotificationsTotal.inc({ outcome: 'sent' });
      } catch (error) {
        // Catch per-token: one expired/invalid/unregistered token must never stop delivery to
        // this user's other devices, or to any other recipient this job is also notifying - a
        // real, common FCM failure mode (specification doesn't require perfect delivery; push is
        // a best-effort channel, same doctrine as WebSocket delivery).
        const code = (error as { code?: string }).code;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Push send failed for device token ${deviceToken.id} (user ${userId}, event ${eventType}): ` +
            `${code ?? message}`,
        );
        this.metrics.pushNotificationsTotal.inc({ outcome: 'failed' });

        // FCM's own signal that this token is permanently dead (app uninstalled, token
        // rotated out from under us, etc.) - any other failure (transient network error, a
        // malformed payload) is left as-is rather than guessing it's permanent.
        if (code === 'messaging/registration-token-not-registered') {
          await this.db.delete(deviceTokens).where(eq(deviceTokens.id, deviceToken.id));
        }
      }
    }
  }
}
