import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsPollerService } from './metrics-poller.service';
import { MetricsService } from './metrics.service';

/**
 * Observability (architecture.md §10): the shared `MetricsService` (a `prom-client` registry +
 * the exact custom metrics §10 names), `GET /metrics` (`MetricsController`), and the gauge
 * poller (`MetricsPollerService`) for the three metrics that are cheaper/safer to recompute
 * periodically than to track incrementally (`active_rides`, `available_drivers`,
 * `outbox_pending_events`).
 *
 * `@Global()`, mirroring `db/drizzle.module.ts`'s own precedent for a cross-cutting dependency
 * every business module needs (rides/dispatch/events/locations/notifications all inject
 * `MetricsService` to increment/observe a metric) - avoids every one of those modules having to
 * add `MetricsModule` to its own `imports` array just to resolve one shared provider, the same
 * reasoning `DrizzleModule` already established for `DRIZZLE`.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsPollerService],
  exports: [MetricsService],
})
export class MetricsModule {}
