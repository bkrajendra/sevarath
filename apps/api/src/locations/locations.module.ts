import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversModule } from '../drivers/drivers.module';
import { LocationCacheService } from './location-cache.service';
import { LocationGateway } from './location.gateway';

/**
 * WebSocket location gateway (`/ws`, architecture.md §6.1/§9.1): connection/auth/room scoping,
 * durable `ride.*` business-event forwarding (consumed elsewhere - see
 * `events/consumers/domain-event-realtime.consumer.ts`, docs/open-items.md #25), and now the
 * live driver-location push pipeline (`driver.location` in, `DriverLocationUpdated` out) plus
 * its dedicated Redis cache (`LocationCacheService`) - docs/open-items.md's Phase 5 location
 * task. No new module imports were needed beyond the existing `AuthModule`/`DriversModule`
 * (JWT verification, resolving a DRIVER socket's `drivers.id`) - the active-ride lookup reads
 * `rides` straight from `DRIZZLE`/`db/schema`, not through `RidesModule`, so no new import
 * direction/cycle risk is introduced.
 *
 * `LocationCacheService` is exported too, in case a later task (e.g. an admin live-ops view,
 * or dispatch reading fresher-than-DB positions - see open-items.md #2) wants the cache without
 * going through the gateway.
 */
@Module({
  imports: [AuthModule, DriversModule],
  providers: [LocationGateway, LocationCacheService],
  exports: [LocationGateway, LocationCacheService],
})
export class LocationsModule {}
