import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { PushNotificationConsumer } from './push-notification.consumer';
import { NOTIFICATION_EVENTS_QUEUE } from '../events/outbox.constants';

/**
 * BullMQ-backed push notifications - plan.md Phase 7. Owns device-token registration
 * (`DeviceTokensController`/`DeviceTokensService`) and the `notification-events` queue consumer
 * (`PushNotificationConsumer`), which is the second leg of `OutboxPublisherService`'s fan-out
 * (see `events/events.module.ts`/docs/open-items.md).
 *
 * Imports `AuthModule` for `FIREBASE_ADMIN` (now exported from there - see auth.module.ts's own
 * comment) so the push consumer reuses the same initialized Firebase app auth already sets up,
 * rather than initializing a second one. Re-registers `NOTIFICATION_EVENTS_QUEUE` here (even
 * though `EventsModule` already registers it for the publisher side) because
 * `PushNotificationConsumer`'s `@Processor`/the queue token it resolves against must come from
 * a registration local to *this* module's DI graph - same split producer/consumer pattern
 * `events.module.ts`'s own comment describes.
 */
@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: NOTIFICATION_EVENTS_QUEUE })],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService, PushNotificationConsumer],
  exports: [DeviceTokensService],
})
export class NotificationsModule {}
