import { MetricsService } from './metrics.service';

/**
 * Unit coverage for the metrics-registration plumbing itself: constructing `MetricsService`
 * registers every architecture.md §10 metric name on its own `Registry`, incrementing/observing
 * one actually shows up in `getMetrics()`'s Prometheus text-exposition output, and default
 * process metrics are included for free. No Nest app boot needed - this is plain `prom-client`
 * wiring.
 */
describe('MetricsService', () => {
  it('registers every architecture.md §10 metric name', async () => {
    const metrics = new MetricsService();
    const output = await metrics.getMetrics();

    const expectedNames = [
      'ride_requests_total',
      'ride_completed_total',
      'ride_cancelled_total',
      'ride_assignment_duration_seconds',
      'active_rides',
      'available_drivers',
      'driver_location_updates_total',
      'websocket_connections',
      'push_notifications_total',
      'outbox_pending_events',
      'outbox_publish_failures_total',
      'outbox_publish_latency_seconds',
    ];

    for (const name of expectedNames) {
      expect(output).toContain(`# TYPE ${name} `);
    }
  });

  it('includes default Node process metrics alongside the custom ones', async () => {
    const metrics = new MetricsService();
    const output = await metrics.getMetrics();

    // A couple of prom-client's standard default metrics - proves collectDefaultMetrics() ran.
    expect(output).toContain('process_cpu_user_seconds_total');
    expect(output).toContain('nodejs_eventloop_lag_seconds');
  });

  it('a counter increment is reflected in the scraped output', async () => {
    const metrics = new MetricsService();

    metrics.rideRequestsTotal.inc();
    metrics.rideRequestsTotal.inc();

    const output = await metrics.getMetrics();
    expect(output).toContain('ride_requests_total 2');
  });

  it('a labeled counter increment carries its label into the scraped output', async () => {
    const metrics = new MetricsService();

    metrics.rideCancelledTotal.inc({ cancelled_by: 'DRIVER' });

    const output = await metrics.getMetrics();
    expect(output).toContain('ride_cancelled_total{cancelled_by="DRIVER"} 1');
  });

  it('a gauge .set() reflects the exact last value, not an accumulation', async () => {
    const metrics = new MetricsService();

    metrics.activeRides.set(5);
    metrics.activeRides.set(3);

    const output = await metrics.getMetrics();
    expect(output).toContain('active_rides 3');
  });

  it('a histogram .observe() is reflected in its _sum/_count series', async () => {
    const metrics = new MetricsService();

    metrics.rideAssignmentDurationSeconds.observe(7);

    const output = await metrics.getMetrics();
    expect(output).toContain('ride_assignment_duration_seconds_sum 7');
    expect(output).toContain('ride_assignment_duration_seconds_count 1');
  });

  it('contentType matches the registry\'s own Prometheus text-exposition content type', () => {
    const metrics = new MetricsService();
    expect(metrics.contentType).toBe(metrics.registry.contentType);
    expect(metrics.contentType).toContain('text/plain');
  });

  it('two separate instances have independent registries (no shared global state)', async () => {
    const a = new MetricsService();
    const b = new MetricsService();

    a.rideRequestsTotal.inc(5);

    const outputA = await a.getMetrics();
    const outputB = await b.getMetrics();
    expect(outputA).toContain('ride_requests_total 5');
    expect(outputB).toContain('ride_requests_total 0');
  });
});
