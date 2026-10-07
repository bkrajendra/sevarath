import { DispatchService } from './dispatch.service';
import { OutboxService } from '../events/outbox/outbox.service';
import { rideOffers, rides, type Driver, type Ride } from '../db/schema';
import { OFFER_RESPONSE_WINDOW_MS, RIDE_OFFER_TIMEOUT_JOB } from './dispatch.constants';
import type { DriverCandidate } from './driver-matcher.service';

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

function makeDriverCandidate(overrides: Partial<Driver> = {}): DriverCandidate {
  return {
    id: 'driver-1',
    userId: 'driver-user-1',
    driverCode: 'DRV-1',
    status: 'ACTIVE',
    availability: 'AVAILABLE',
    currentVehicleId: 'vehicle-1',
    currentLatitude: 24.9,
    currentLongitude: 72.7,
    locationUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    distanceMeters: 100,
  } as DriverCandidate;
}

/** Awaitable value that is ALSO chainable with `.returning()` - mimics drizzle's insert/update
 * builders, which can be awaited directly (no RETURNING) or chained with `.returning()`. */
function awaitableWithReturning(returningRows: unknown[]) {
  const thenable = Promise.resolve(undefined) as any;
  thenable.returning = jest.fn().mockResolvedValue(returningRows);
  return thenable;
}

function makeFakeTx(opts: { updatedRide?: Ride | null; insertedOffer?: { id: string } }) {
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: unknown }> = [];

  const tx = {
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((values: unknown) => {
        insertCalls.push({ table, values });
        if (table === rideOffers) {
          return awaitableWithReturning(opts.insertedOffer ? [opts.insertedOffer] : []);
        }
        return awaitableWithReturning([]);
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((values: unknown) => {
        updateCalls.push({ table, values });
        return {
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue(
              table === rides ? (opts.updatedRide ? [opts.updatedRide] : []) : [],
            ),
          })),
        };
      }),
    })),
  };

  return { tx, insertCalls, updateCalls };
}

describe('DispatchService', () => {
  let outboxService: OutboxService;

  beforeEach(() => {
    outboxService = new OutboxService();
    jest.spyOn(outboxService, 'record').mockResolvedValue(undefined);
  });

  it('onRideRequested: no candidates found transitions the ride straight to NO_DRIVER_AVAILABLE', async () => {
    const { tx, updateCalls, insertCalls } = makeFakeTx({
      updatedRide: makeRide({ status: 'NO_DRIVER_AVAILABLE' }),
    });
    const db = { transaction: jest.fn((cb: any) => cb(tx)) };
    const driverMatcher = { findCandidates: jest.fn().mockResolvedValue([]) };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };

    const service = new DispatchService(db as any, outboxService, driverMatcher as any, queue as any);

    await service.onRideRequested({
      rideId: 'ride-1',
      userId: 'user-1',
      pickup: { latitude: 24.9, longitude: 72.7 },
      destination: { latitude: 24.91, longitude: 72.71 },
    });

    expect(driverMatcher.findCandidates).toHaveBeenCalledWith({ latitude: 24.9, longitude: 72.7 }, []);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values).toMatchObject({ status: 'NO_DRIVER_AVAILABLE' });
    expect(insertCalls.some((c) => (c.values as any).eventType === 'RideNoDriverAvailable')).toBe(true);
    expect(outboxService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'RideNoDriverAvailable', aggregateId: 'ride-1' }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('onRideRequested: a candidate present creates a PENDING offer and schedules the 15s timeout job', async () => {
    const { tx, insertCalls } = makeFakeTx({ insertedOffer: { id: 'offer-1' } });
    const db = { transaction: jest.fn((cb: any) => cb(tx)) };
    const candidate = makeDriverCandidate({ id: 'driver-1' });
    const driverMatcher = { findCandidates: jest.fn().mockResolvedValue([candidate]) };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };

    const service = new DispatchService(db as any, outboxService, driverMatcher as any, queue as any);

    await service.onRideRequested({
      rideId: 'ride-1',
      userId: 'user-1',
      pickup: { latitude: 24.9, longitude: 72.7 },
      destination: { latitude: 24.91, longitude: 72.71 },
    });

    expect(insertCalls.some((c) => (c.values as any).result === 'PENDING')).toBe(true);
    expect(insertCalls.some((c) => (c.values as any).eventType === 'RideDriverNotified')).toBe(true);
    expect(outboxService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'RideDriverNotified', payload: { rideId: 'ride-1', driverId: 'driver-1' } }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      RIDE_OFFER_TIMEOUT_JOB,
      { offerId: 'offer-1', rideId: 'ride-1', driverId: 'driver-1' },
      { delay: OFFER_RESPONSE_WINDOW_MS },
    );
  });

  it('advanceToNextDriver: does nothing once the ride has left SEARCHING_DRIVER', async () => {
    const { tx } = makeFakeTx({});
    const db = {
      transaction: jest.fn((cb: any) => cb(tx)),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([makeRide({ status: 'DRIVER_ASSIGNED' })]),
        })),
      })),
    };
    const driverMatcher = { findCandidates: jest.fn() };
    const queue = { add: jest.fn() };

    const service = new DispatchService(db as any, outboxService, driverMatcher as any, queue as any);

    await service.advanceToNextDriver('ride-1', []);

    expect(driverMatcher.findCandidates).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
