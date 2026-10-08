import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DrizzleModule } from './db/drizzle.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { RidesModule } from './rides/rides.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { LocationsModule } from './locations/locations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MapsModule } from './maps/maps.module';
import { CampusModule } from './campus/campus.module';
import { AdminModule } from './admin/admin.module';
import { EventsModule } from './events/events.module';
import { CommonModule } from './common/common.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    // Global default rate limit (Phase 9 hardening - see docs/open-items.md). 100 req/min per
    // IP is a generous-but-real baseline for this system's actual scale (an internal campus
    // app, not a public SaaS) - loose enough that no legitimate single-page-load burst of
    // parallel requests should ever trip it, tight enough to blunt a runaway/misbehaving client
    // or a crude scripted scrape. The brute-force-prone unauthenticated auth endpoints
    // (auth.controller.ts's login/login-password/register) override this with a much stricter
    // per-handler @Throttle(...) - see that file. `/health*` and `/metrics` are exempted via
    // @SkipThrottle() on their own controllers (an orchestrator/scraper hitting those often is
    // normal, not abuse), and the `/ws` gateway's own message handler is exempted the same way
    // (its connection handshake was never guarded in the first place - Nest's guard pipeline
    // does not run on OnGatewayConnection/OnGatewayDisconnect lifecycle hooks, only on
    // @SubscribeMessage handlers - see location.gateway.ts).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
          },
        };
      },
    }),
    DrizzleModule,
    MetricsModule,
    AuthModule,
    UsersModule,
    HealthModule,
    DriversModule,
    VehiclesModule,
    RidesModule,
    DispatchModule,
    LocationsModule,
    NotificationsModule,
    MapsModule,
    CampusModule,
    AdminModule,
    EventsModule,
    CommonModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
