import { MetricsPollerService } from './metrics-poller.service';
import { drivers, outboxEvents, rides } from '../db/schema';

/**
 * Unit coverage for `MetricsPollerService#poll` - mocks `DRIZZLE` (no DB/app boot needed) and
 * checks each of the three gauges is `.set()` to the count the mocked query returns, routed to
 * the right table.
 */
describe('MetricsPollerService', () => {
  function makeDbMock(valuesByTable: Map<unknown, number>) {
    const select = jest.fn().mockImplementation(() => ({
      from: jest.fn().mockImplementation((table: unknown) => ({
        where: jest.fn().mockImplementation(() => Promise.resolve([{ value: valuesByTable.get(table) ?? 0 }])),
      })),
    }));
    return { select };
  }

  function makeMetricsMock() {
    return {
      activeRides: { set: jest.fn() },
      availableDrivers: { set: jest.fn() },
      outboxPendingEvents: { set: jest.fn() },
    };
  }

  it('sets active_rides, available_drivers, and outbox_pending_events from their respective counts', async () => {
    const valuesByTable = new Map<unknown, number>([
      [rides, 4],
      [drivers, 7],
      [outboxEvents, 2],
    ]);
    const db = makeDbMock(valuesByTable);
    const metrics = makeMetricsMock();
    const poller = new MetricsPollerService(db as any, metrics as any);

    await poller.poll();

    expect(metrics.activeRides.set).toHaveBeenCalledWith(4);
    expect(metrics.availableDrivers.set).toHaveBeenCalledWith(7);
    expect(metrics.outboxPendingEvents.set).toHaveBeenCalledWith(2);
  });

  it('defaults to 0 when a query returns no rows', async () => {
    const db = makeDbMock(new Map());
    const metrics = makeMetricsMock();
    const poller = new MetricsPollerService(db as any, metrics as any);

    await poller.poll();

    expect(metrics.activeRides.set).toHaveBeenCalledWith(0);
    expect(metrics.availableDrivers.set).toHaveBeenCalledWith(0);
    expect(metrics.outboxPendingEvents.set).toHaveBeenCalledWith(0);
  });

  it('does not throw when a query fails - a transient DB hiccup must not crash the interval', async () => {
    const select = jest.fn().mockImplementation(() => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockRejectedValue(new Error('connection reset')),
      }),
    }));
    const metrics = makeMetricsMock();
    const poller = new MetricsPollerService({ select } as any, metrics as any);

    await expect(poller.poll()).resolves.toBeUndefined();
  });
});
