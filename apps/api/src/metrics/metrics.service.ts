import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Shared Prometheus metrics registry + the exact custom metrics architecture.md §10 names,
 * injected via DI (not a module-level singleton import) so every service that needs to
 * increment/observe one just takes `MetricsService` as a constructor param, the same way every
 * other cross-cutting dependency (DRIZZLE, OutboxService, ...) is already injected in this
 * codebase.
 *
 * One `Registry` instance per `MetricsService` instance (itself a singleton within one Nest
 * application), not `prom-client`'s shared global `register` - this avoids any cross-app-
 * instance leakage between, e.g., multiple `AppModule` boots in the same Jest process (each
 * test file's own app gets its own registry, never aliasing another test's counters).
 *
 * `collectDefaultMetrics()` (process CPU/memory/event-loop/GC, Node version, etc.) is added for
 * free alongside the custom metrics - verified (docs/open-items.md) to collect synchronously on
 * scrape in prom-client@15, not via a background `setInterval`, so it introduces no dangling
 * timer/open-handle risk for Jest's "did not exit" check (docs/open-items.md #19).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly rideRequestsTotal = new Counter({
    name: 'ride_requests_total',
    help: 'Total number of rides successfully created (RidesService#create).',
    registers: [this.registry],
  });

  readonly rideCompletedTotal = new Counter({
    name: 'ride_completed_total',
    help: 'Total number of rides completed (RidesService#complete).',
    registers: [this.registry],
  });

  /**
   * `cancelled_by` label: 'USER' | 'DRIVER' - derived directly from the ride state machine's own
   * target status (CANCELLED_BY_USER/CANCELLED_BY_DRIVER), not re-derived from the requester's
   * role, so it can never disagree with what was actually persisted.
   */
  readonly rideCancelledTotal = new Counter({
    name: 'ride_cancelled_total',
    help: 'Total number of rides cancelled, labeled by who cancelled.',
    labelNames: ['cancelled_by'] as const,
    registers: [this.registry],
  });

  /**
   * Time from a ride entering SEARCHING_DRIVER to DRIVER_ASSIGNED (AssignmentService#accept),
   * i.e. acceptedAt - requestedAt. Buckets span from a near-instant accept up to several full
   * 15s-offer-window cascades (architecture.md §4.2's bounded response window), so both a quick
   * single-driver accept and a long multi-candidate cascade land in a meaningful bucket.
   */
  readonly rideAssignmentDurationSeconds = new Histogram({
    name: 'ride_assignment_duration_seconds',
    help: 'Time from a ride entering SEARCHING_DRIVER to DRIVER_ASSIGNED.',
    buckets: [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300],
    registers: [this.registry],
  });

  readonly activeRides = new Gauge({
    name: 'active_rides',
    help: 'Current number of rides not in a terminal status (periodic poll, MetricsPollerService).',
    registers: [this.registry],
  });

  readonly availableDrivers = new Gauge({
    name: 'available_drivers',
    help: 'Current number of drivers with availability = AVAILABLE (periodic poll, MetricsPollerService).',
    registers: [this.registry],
  });

  /** `outcome` label: 'accepted' | 'rejected_low_accuracy' (location.gateway.ts's accuracy filter). */
  readonly driverLocationUpdatesTotal = new Counter({
    name: 'driver_location_updates_total',
    help: "Total number of driver.location WebSocket pushes received, labeled by outcome.",
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly websocketConnections = new Gauge({
    name: 'websocket_connections',
    help: 'Current number of authenticated /ws WebSocket connections (location.gateway.ts).',
    registers: [this.registry],
  });

  /** `outcome` label: 'sent' | 'skipped_no_token' | 'skipped_not_configured' | 'failed'. */
  readonly pushNotificationsTotal = new Counter({
    name: 'push_notifications_total',
    help: 'Total number of push notification attempts, labeled by outcome.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly outboxPendingEvents = new Gauge({
    name: 'outbox_pending_events',
    help: 'Current number of outbox_events rows with published_at IS NULL (periodic poll, MetricsPollerService).',
    registers: [this.registry],
  });

  readonly outboxPublishFailuresTotal = new Counter({
    name: 'outbox_publish_failures_total',
    help: 'Total number of outbox publish attempts that failed (OutboxPublisherService#markFailed).',
    registers: [this.registry],
  });

  /** Time between outbox_events.created_at and the row being marked published - the publisher's own ~2s poll interval sets the useful bucket floor. */
  readonly outboxPublishLatencySeconds = new Histogram({
    name: 'outbox_publish_latency_seconds',
    help: 'Time between outbox_events.created_at and the row being marked published.',
    buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
