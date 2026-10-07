import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsModule } from '../events/events.module';
import { DriversModule } from '../drivers/drivers.module';
import { DriverMatcherService } from './driver-matcher.service';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';
import { RideOfferTimeoutProcessor } from './ride-offer-timeout.processor';
import { DispatchController, DispatchOffersController } from './dispatch.controller';
import { RIDE_OFFER_TIMEOUT_QUEUE } from './dispatch.constants';

/** Nearest-driver matching + atomic assignment - see architecture.md §4.2 and plan.md Phase 4. */
@Module({
  imports: [
    EventsModule,
    DriversModule,
    BullModule.registerQueue({ name: RIDE_OFFER_TIMEOUT_QUEUE }),
  ],
  providers: [DriverMatcherService, DispatchService, AssignmentService, RideOfferTimeoutProcessor],
  controllers: [DispatchController, DispatchOffersController],
})
export class DispatchModule {}
