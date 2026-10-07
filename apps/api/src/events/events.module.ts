import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboxService } from './outbox/outbox.service';
import { OutboxPublisherService } from './publisher/outbox-publisher.service';
import { DOMAIN_EVENTS_QUEUE } from './outbox.constants';

@Module({
  imports: [BullModule.registerQueue({ name: DOMAIN_EVENTS_QUEUE })],
  providers: [OutboxService, OutboxPublisherService],
  exports: [OutboxService],
})
export class EventsModule {}
