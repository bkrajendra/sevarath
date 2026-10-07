import * as admin from 'firebase-admin';
import { PushNotificationConsumer } from './push-notification.consumer';
import type { DomainEventJob } from '../events/publisher/outbox-publisher.service';
import { rides, drivers, deviceTokens, type Ride, type Driver, type DeviceToken } from '../db/schema';

jest.mock('firebase-admin', () => ({
  messaging: jest.fn(),
}));

function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'ride-1',
    userId: 'rider-user-1',
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

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1',
    userId: 'driver-user-1',
    driverCode: 'DRV-1',
    status: 'ACTIVE',
    availability: 'AVAILABLE',
    currentVehicleId: null,
    currentLatitude: null,
    currentLongitude: null,
    locationUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeToken(overrides: Partial<DeviceToken> = {}): DeviceToken {
  return {
    id: 'token-1',
    userId: 'rider-user-1',
    token: 'fcm-token-1',
    platform: 'ANDROID',
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

/**
 * A `db.select().from(TABLE).where(...)` mock that returns canned rows per table, consumed in
 * FIFO order per table (the consumer only ever does at most one lookup per table per recipient,
 * in a deterministic sequential order - see push-notification.consumer.ts). `db.delete(...)` is
 * also tracked, for the token-invalidation assertions.
 */
function makeDbMock(opts: { rideRows?: Ride[][]; driverRows?: Driver[][]; tokenRows?: DeviceToken[][] }) {
  const rideQueue = [...(opts.rideRows ?? [])];
  const driverQueue = [...(opts.driverRows ?? [])];
  const tokenQueue = [...(opts.tokenRows ?? [])];

  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const deleteFn = jest.fn().mockReturnValue({ where: deleteWhere });

  const select = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation((table: unknown) => ({
      where: jest.fn().mockImplementation(() => {
        if (table === rides) return Promise.resolve(rideQueue.shift() ?? []);
        if (table === drivers) return Promise.resolve(driverQueue.shift() ?? []);
        if (table === deviceTokens) return Promise.resolve(tokenQueue.shift() ?? []);
        throw new Error('unexpected table in test db mock');
      }),
    })),
  }));

  return { select, delete: deleteFn, deleteWhere } as const;
}

describe('PushNotificationConsumer', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock = jest.fn().mockResolvedValue('message-id');
    (admin.messaging as unknown as jest.Mock).mockReturnValue({ send: sendMock });
  });

  it('no-ops for a non-ride aggregateType without touching the DB or messaging', async () => {
    const db = makeDbMock({});
    const consumer = new PushNotificationConsumer(db as any, {} as any);

    await consumer.process(makeJob({ aggregateType: 'something-else' }) as any);

    expect(db.select).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(['RideRequested', 'RideSearchingDriver'])(
    '%s has no push recipients and never touches the DB (WS/HTTP already cover it)',
    async (eventType) => {
      const db = makeDbMock({});
      const consumer = new PushNotificationConsumer(db as any, {} as any);

      await consumer.process(makeJob({ eventType }) as any);

      expect(db.select).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    },
  );

  it('logs and returns (no throw) when the ride is not found', async () => {
    const db = makeDbMock({ rideRows: [[]] });
    const consumer = new PushNotificationConsumer(db as any, {} as any);

    await expect(
      consumer.process(makeJob({ eventType: 'DriverArrived', aggregateId: 'missing-ride' }) as any),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('RideAssigned pushes only to the rider - the driver who just accepted is never notified', async () => {
    const ride = makeRide({ driverId: 'driver-1', status: 'DRIVER_ASSIGNED' });
    const db = makeDbMock({ rideRows: [[ride]], tokenRows: [[makeToken()]] });
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await consumer.process(
      makeJob({ eventType: 'RideAssigned', payload: { rideId: 'ride-1', driverId: 'driver-1' } }) as any,
    );

    // Only one deviceTokens lookup (for the rider) - no drivers lookup at all, since 'rider' is
    // the only recipient and resolving it needs no driverId -> userId hop.
    expect(db.select).toHaveBeenCalledTimes(2); // ride + tokens
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      token: 'fcm-token-1',
      notification: { title: 'Driver on the way', body: 'A driver has been assigned to your ride and is heading your way.' },
      data: { rideId: 'ride-1', eventType: 'RideAssigned' },
    });
  });

  it('RideDriverNotified pushes to the offered driver named in the payload, not rides.driverId', async () => {
    const ride = makeRide({ driverId: null }); // not assigned yet
    const driver = makeDriver({ id: 'driver-offered', userId: 'driver-user-offered' });
    const token = makeToken({ userId: 'driver-user-offered', token: 'driver-fcm-token' });
    const db = makeDbMock({ rideRows: [[ride]], driverRows: [[driver]], tokenRows: [[token]] });
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await consumer.process(
      makeJob({ eventType: 'RideDriverNotified', payload: { rideId: 'ride-1', driverId: 'driver-offered' } }) as any,
    );

    expect(sendMock).toHaveBeenCalledWith({
      token: 'driver-fcm-token',
      notification: expect.objectContaining({ title: 'New ride request nearby' }),
      data: { rideId: 'ride-1', eventType: 'RideDriverNotified' },
    });
  });

  it('RideDriverNotified with no payload.driverId skips delivery without a drivers lookup', async () => {
    const db = makeDbMock({ rideRows: [[makeRide()]] });
    const consumer = new PushNotificationConsumer(db as any, {} as any);

    await consumer.process(makeJob({ eventType: 'RideDriverNotified', payload: {} }) as any);

    expect(sendMock).not.toHaveBeenCalled();
  });

  describe('RideCancelled', () => {
    it('pushes only to the rider when the driver cancelled', async () => {
      const ride = makeRide({ driverId: 'driver-1', status: 'CANCELLED_BY_DRIVER' });
      const db = makeDbMock({ rideRows: [[ride]], tokenRows: [[makeToken()]] });
      const firebaseApp = { name: 'fake-app' };
      const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

      await consumer.process(
        makeJob({
          eventType: 'RideCancelled',
          payload: { rideId: 'ride-1', cancelledBy: 'CANCELLED_BY_DRIVER', reason: null },
        }) as any,
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ notification: { title: 'Ride cancelled', body: 'Your driver cancelled the ride.' } }),
      );
    });

    it('pushes only to the assigned driver when the rider cancelled', async () => {
      const ride = makeRide({ driverId: 'driver-1', status: 'CANCELLED_BY_USER' });
      const driver = makeDriver({ id: 'driver-1', userId: 'driver-user-1' });
      const token = makeToken({ userId: 'driver-user-1', token: 'driver-fcm-token' });
      const db = makeDbMock({ rideRows: [[ride]], driverRows: [[driver]], tokenRows: [[token]] });
      const firebaseApp = { name: 'fake-app' };
      const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

      await consumer.process(
        makeJob({
          eventType: 'RideCancelled',
          payload: { rideId: 'ride-1', cancelledBy: 'CANCELLED_BY_USER', reason: null },
        }) as any,
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'driver-fcm-token',
          notification: { title: 'Ride cancelled', body: 'The rider cancelled the ride.' },
        }),
      );
    });

    it('skips the assignedDriver recipient (no-op) when no driver was ever assigned', async () => {
      const ride = makeRide({ driverId: null, status: 'CANCELLED_BY_USER' });
      const db = makeDbMock({ rideRows: [[ride]] });
      const firebaseApp = { name: 'fake-app' };
      const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

      await consumer.process(
        makeJob({
          eventType: 'RideCancelled',
          payload: { rideId: 'ride-1', cancelledBy: 'CANCELLED_BY_USER', reason: null },
        }) as any,
      );

      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  it('skips sending (no throw) when the recipient has no registered device tokens', async () => {
    const db = makeDbMock({ rideRows: [[makeRide({ status: 'DRIVER_ARRIVED' })]], tokenRows: [[]] });
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await expect(
      consumer.process(makeJob({ eventType: 'DriverArrived', payload: { rideId: 'ride-1' } }) as any),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips sending (no throw, no messaging call) when FIREBASE_ADMIN is not configured (null)', async () => {
    const db = makeDbMock({ rideRows: [[makeRide({ status: 'DRIVER_ARRIVED' })]], tokenRows: [[makeToken()]] });
    const consumer = new PushNotificationConsumer(db as any, null);

    await expect(
      consumer.process(makeJob({ eventType: 'DriverArrived', payload: { rideId: 'ride-1' } }) as any),
    ).resolves.toBeUndefined();
    expect(admin.messaging).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends to every registered token for the recipient, independently', async () => {
    const tokenA = makeToken({ id: 'token-a', token: 'fcm-a' });
    const tokenB = makeToken({ id: 'token-b', token: 'fcm-b' });
    const db = makeDbMock({
      rideRows: [[makeRide({ status: 'RIDE_STARTED' })]],
      tokenRows: [[tokenA, tokenB]],
    });
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await consumer.process(makeJob({ eventType: 'RideStarted', payload: { rideId: 'ride-1' } }) as any);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ token: 'fcm-a' }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ token: 'fcm-b' }));
  });

  it('one failing token does not stop delivery to the recipient\'s other tokens', async () => {
    const tokenA = makeToken({ id: 'token-a', token: 'fcm-a' });
    const tokenB = makeToken({ id: 'token-b', token: 'fcm-b' });
    const db = makeDbMock({
      rideRows: [[makeRide({ status: 'RIDE_STARTED' })]],
      tokenRows: [[tokenA, tokenB]],
    });
    sendMock.mockRejectedValueOnce(Object.assign(new Error('internal error'), { code: 'messaging/internal-error' }));
    sendMock.mockResolvedValueOnce('message-id-b');
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await expect(
      consumer.process(makeJob({ eventType: 'RideStarted', payload: { rideId: 'ride-1' } }) as any),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes a token FCM reports as permanently unregistered, but leaves other failure codes alone', async () => {
    const tokenA = makeToken({ id: 'token-a', token: 'fcm-a' });
    const db = makeDbMock({
      rideRows: [[makeRide({ status: 'COMPLETED' })]],
      tokenRows: [[tokenA]],
    });
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('not registered'), { code: 'messaging/registration-token-not-registered' }),
    );
    const firebaseApp = { name: 'fake-app' };
    const consumer = new PushNotificationConsumer(db as any, firebaseApp as any);

    await consumer.process(makeJob({ eventType: 'RideCompleted', payload: { rideId: 'ride-1' } }) as any);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.deleteWhere).toHaveBeenCalledTimes(1);
  });
});
