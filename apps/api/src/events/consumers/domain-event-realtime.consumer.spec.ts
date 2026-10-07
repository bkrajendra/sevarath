import { DomainEventRealtimeConsumer } from './domain-event-realtime.consumer';
import type { DomainEventJob } from '../publisher/outbox-publisher.service';
import { rides, type Ride } from '../../db/schema';

function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'ride-1',
    userId: 'user-1',
    driverId: null,
    vehicleId: null,
    pickupLatitude: 24.9,
    pickupLongitude: 72.7,
    pickupLocationName: null,
    destinationLatitude: 24.91,
    destinationLongitude: 72.71,
    destinationLocationName: null,
    status: 'SEARCHING_DRIVER',
    requestedAt: new Date(),
    acceptedAt: null,
    driverArrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<DomainEventJob> = {}): { data: DomainEventJob } {
  return {
    data: {
      eventId: 'event-1',
      eventType: 'RideAssigned',
      aggregateType: 'ride',
      aggregateId: 'ride-1',
      payload: {},
      correlationId: null,
      occurredAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      ...overrides,
    },
  };
}

/** Minimal mock of drizzle's `db.select().from(rides).where(...)`, resolving to `row` (or []). */
function makeDbMock(row: Ride | null) {
  const where = jest.fn().mockResolvedValue(row ? [row] : []);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select, from, where } as const;
}

function makeGatewayMock() {
  return { emitToUser: jest.fn(), emitToDriver: jest.fn() } as const;
}

describe('DomainEventRealtimeConsumer', () => {
  it('no-ops for a non-ride aggregateType without touching the DB or gateway', async () => {
    const db = makeDbMock(null);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ aggregateType: 'something-else' }) as any);

    expect(db.select).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('no-ops for an unknown eventType not present in the routing table', async () => {
    const db = makeDbMock(makeRide());
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ eventType: 'SomeFutureEvent' }) as any);

    expect(db.select).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('logs and returns (no throw) when the ride is not found', async () => {
    const db = makeDbMock(null);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await expect(consumer.process(makeJob() as any)).resolves.toBeUndefined();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('RideRequested reaches nobody', async () => {
    const db = makeDbMock(makeRide());
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ eventType: 'RideRequested' }) as any);

    expect(db.select).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('RideSearchingDriver reaches nobody', async () => {
    const db = makeDbMock(makeRide());
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ eventType: 'RideSearchingDriver' }) as any);

    expect(db.select).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('RideDriverNotified reaches only the offered driver named in the payload, not rides.driverId', async () => {
    const ride = makeRide({ driverId: null }); // not assigned yet
    const db = makeDbMock(ride);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(
      makeJob({ eventType: 'RideDriverNotified', payload: { rideId: 'ride-1', driverId: 'driver-offered' } }) as any,
    );

    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(gateway.emitToDriver).toHaveBeenCalledTimes(1);
    expect(gateway.emitToDriver).toHaveBeenCalledWith(
      'driver-offered',
      'RideDriverNotified',
      expect.objectContaining({ rideId: 'ride-1', status: 'SEARCHING_DRIVER', driverId: 'driver-offered' }),
    );
  });

  it('RideDriverNotified with no payload.driverId logs and skips delivery (no throw)', async () => {
    const db = makeDbMock(makeRide());
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await expect(
      consumer.process(makeJob({ eventType: 'RideDriverNotified', payload: {} }) as any),
    ).resolves.toBeUndefined();
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('RideAssigned reaches both the rider and the now-assigned driver', async () => {
    const ride = makeRide({ driverId: 'driver-1', status: 'DRIVER_ASSIGNED' });
    const db = makeDbMock(ride);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(
      makeJob({ eventType: 'RideAssigned', payload: { rideId: 'ride-1', driverId: 'driver-1', vehicleId: 'vehicle-1' } }) as any,
    );

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'RideAssigned',
      expect.objectContaining({ rideId: 'ride-1', status: 'DRIVER_ASSIGNED', driverId: 'driver-1', vehicleId: 'vehicle-1' }),
    );
    expect(gateway.emitToDriver).toHaveBeenCalledWith(
      'driver-1',
      'RideAssigned',
      expect.objectContaining({ rideId: 'ride-1', status: 'DRIVER_ASSIGNED' }),
    );
  });

  it('RideCancelled reaches the rider and the assigned driver when one was assigned', async () => {
    const ride = makeRide({ driverId: 'driver-1', status: 'CANCELLED_BY_USER' });
    const db = makeDbMock(ride);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(
      makeJob({ eventType: 'RideCancelled', payload: { rideId: 'ride-1', cancelledBy: 'CANCELLED_BY_USER', reason: null } }) as any,
    );

    expect(gateway.emitToUser).toHaveBeenCalledWith('user-1', 'RideCancelled', expect.any(Object));
    expect(gateway.emitToDriver).toHaveBeenCalledWith('driver-1', 'RideCancelled', expect.any(Object));
  });

  it('RideCancelled with no driver ever assigned reaches only the rider (assignedDriver is a no-op)', async () => {
    const ride = makeRide({ driverId: null, status: 'CANCELLED_BY_USER' });
    const db = makeDbMock(ride);
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(
      makeJob({ eventType: 'RideCancelled', payload: { rideId: 'ride-1', cancelledBy: 'CANCELLED_BY_USER', reason: null } }) as any,
    );

    expect(gateway.emitToUser).toHaveBeenCalledWith('user-1', 'RideCancelled', expect.any(Object));
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it('RideNoDriverAvailable reaches only the rider', async () => {
    const db = makeDbMock(makeRide({ status: 'NO_DRIVER_AVAILABLE' }));
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ eventType: 'RideNoDriverAvailable', payload: { rideId: 'ride-1' } }) as any);

    expect(gateway.emitToUser).toHaveBeenCalledWith('user-1', 'RideNoDriverAvailable', expect.any(Object));
    expect(gateway.emitToDriver).not.toHaveBeenCalled();
  });

  it.each(['DriverArrived', 'RideStarted', 'RideCompleted'])(
    '%s reaches only the rider, not the driver (the driver already knows/initiated it)',
    async (eventType) => {
      const ride = makeRide({ driverId: 'driver-1', status: 'DRIVER_ARRIVED' });
      const db = makeDbMock(ride);
      const gateway = makeGatewayMock();
      const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

      await consumer.process(makeJob({ eventType, payload: { rideId: 'ride-1', driverId: 'driver-1' } }) as any);

      expect(gateway.emitToUser).toHaveBeenCalledWith('user-1', eventType, expect.any(Object));
      expect(gateway.emitToDriver).not.toHaveBeenCalled();
    },
  );

  it('selects the ride by aggregateId via drizzle, scoped to the rides table', async () => {
    const db = makeDbMock(makeRide());
    const gateway = makeGatewayMock();
    const consumer = new DomainEventRealtimeConsumer(db as any, gateway as any);

    await consumer.process(makeJob({ eventType: 'DriverArrived', aggregateId: 'ride-1' }) as any);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith(rides);
  });
});
