import { buildNotificationCopy } from './push-notification-copy';

describe('buildNotificationCopy', () => {
  it('builds non-empty title/body for every pushed eventType', () => {
    const cases: Array<[string, 'rider' | 'assignedDriver' | 'offeredDriver']> = [
      ['RideDriverNotified', 'offeredDriver'],
      ['RideAssigned', 'rider'],
      ['RideNoDriverAvailable', 'rider'],
      ['DriverArrived', 'rider'],
      ['RideStarted', 'rider'],
      ['RideCompleted', 'rider'],
    ];

    for (const [eventType, recipient] of cases) {
      const copy = buildNotificationCopy(eventType, recipient);
      expect(copy).not.toBeNull();
      expect(copy!.title.length).toBeGreaterThan(0);
      expect(copy!.body.length).toBeGreaterThan(0);
    }
  });

  it('RideCancelled copy differs for the rider vs. the assigned driver', () => {
    const toRider = buildNotificationCopy('RideCancelled', 'rider');
    const toDriver = buildNotificationCopy('RideCancelled', 'assignedDriver');

    expect(toRider).toEqual({ title: 'Ride cancelled', body: 'Your driver cancelled the ride.' });
    expect(toDriver).toEqual({ title: 'Ride cancelled', body: 'The rider cancelled the ride.' });
    expect(toRider).not.toEqual(toDriver);
  });

  it('returns null for an eventType with no defined copy (WS-only event)', () => {
    expect(buildNotificationCopy('RideRequested', 'rider')).toBeNull();
    expect(buildNotificationCopy('RideSearchingDriver', 'rider')).toBeNull();
    expect(buildNotificationCopy('SomeFutureEvent', 'rider')).toBeNull();
  });
});
