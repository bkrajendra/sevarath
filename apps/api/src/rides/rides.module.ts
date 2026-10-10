import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DriversModule } from '../drivers/drivers.module';
import { UsersModule } from '../users/users.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

/** Ride entity + state machine - see architecture.md §4.1 and plan.md Phase 4. */
@Module({
  imports: [EventsModule, DriversModule, UsersModule, VehiclesModule],
  controllers: [RidesController],
  // IdempotencyInterceptor is used class-based (@UseInterceptors(IdempotencyInterceptor)) on
  // some of this controller's routes, so Nest needs it registered as a provider in this
  // module's DI container to be able to instantiate it. It only depends on DRIZZLE, which
  // DrizzleModule provides globally (@Global()); it is otherwise stateless, so registering the
  // same class again in DispatchModule is fine - each module gets its own instance.
  providers: [RidesService, IdempotencyInterceptor],
  exports: [RidesService],
})
export class RidesModule {}
