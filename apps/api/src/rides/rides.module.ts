import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DriversModule } from '../drivers/drivers.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

/** Ride entity + state machine - see architecture.md §4.1 and plan.md Phase 4. */
@Module({
  imports: [EventsModule, DriversModule],
  controllers: [RidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}
