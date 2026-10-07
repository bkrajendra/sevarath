import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversModule } from '../drivers/drivers.module';
import { LocationGateway } from './location.gateway';

/**
 * WebSocket location gateway (`/ws`, architecture.md §6.1/§9.1) - connection, auth, room
 * scoping only for now. Business-event forwarding (consuming the `domain-events` BullMQ
 * queue so `ride.*` events reach these rooms) and the driver location push pipeline/Redis
 * cache are separate, already-planned follow-up tasks - see plan.md Phase 5.
 */
@Module({
  imports: [AuthModule, DriversModule],
  providers: [LocationGateway],
  exports: [LocationGateway],
})
export class LocationsModule {}
