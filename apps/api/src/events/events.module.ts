import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LocationsModule } from '../locations/locations.module';
import { OutboxService } from './outbox/outbox.service';
import { OutboxPublisherService } from './publisher/outbox-publisher.service';
import { DomainEventRealtimeConsumer } from './consumers/domain-event-realtime.consumer';
import { DOMAIN_EVENTS_QUEUE } from './outbox.constants';

/**
 * Owns the outbox end to end: write (`OutboxService`), publish (`OutboxPublisherService`), and
 * now (Phase 5) real-time delivery (`DomainEventRealtimeConsumer`, which forwards queued
 * `domain-events` jobs to the right WebSocket room via `LocationGateway` - see
 * docs/open-items.md #3/#22). `LocationsModule` is imported here (not the other way around) -
 * `LocationsModule` has no reason to know about the outbox, and importing it this direction
 * avoids a cycle. The `domain-events` queue only needs registering once since the consumer
 * lives in this same module alongside the publisher that already registers it (contrast
 * `dispatch.module.ts`, whose queue's producer and consumer are also both local to it, but
 * which re-registers its own queue defensively anyway - not needed here since nothing in this
 * module today requires that extra registration).
 */
@Module({
  imports: [BullModule.registerQueue({ name: DOMAIN_EVENTS_QUEUE }), LocationsModule],
  providers: [OutboxService, OutboxPublisherService, DomainEventRealtimeConsumer],
  exports: [OutboxService],
})
export class EventsModule {}
