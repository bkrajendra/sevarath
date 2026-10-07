import { PUSH_EVENT_ROUTING, resolveCancelledRecipients, resolvePushRecipients } from './push-recipients';

describe('resolvePushRecipients', () => {
  it('RideRequested and RideSearchingDriver reach nobody (WS/HTTP already cover these)', () => {
    expect(resolvePushRecipients('RideRequested', {})).toEqual([]);
    expect(resolvePushRecipients('RideSearchingDriver', {})).toEqual([]);
  });

  it('RideDriverNotified pushes only to the offered driver', () => {
    expect(resolvePushRecipients('RideDriverNotified', { driverId: 'd1' })).toEqual(['offeredDriver']);
  });

  it('RideAssigned pushes only to the rider, not the driver who just accepted', () => {
    // Diverges deliberately from the WS routing table (which notifies both) - see
    // push-recipients.ts's doc comment.
    expect(resolvePushRecipients('RideAssigned', {})).toEqual(['rider']);
  });

  it.each(['RideNoDriverAvailable', 'DriverArrived', 'RideStarted', 'RideCompleted'])(
    '%s pushes only to the rider',
    (eventType) => {
      expect(resolvePushRecipients(eventType, {})).toEqual(['rider']);
    },
  );

  it('an eventType with no routing entry reaches nobody rather than throwing', () => {
    expect(resolvePushRecipients('SomeFutureEvent', {})).toEqual([]);
  });

  it('RideCancelled has no static table entry - recipients come from resolveCancelledRecipients', () => {
    expect(PUSH_EVENT_ROUTING).not.toHaveProperty('RideCancelled');
  });

  describe('RideCancelled', () => {
    it('pushes only to the rider when the driver cancelled', () => {
      expect(resolvePushRecipients('RideCancelled', { cancelledBy: 'CANCELLED_BY_DRIVER' })).toEqual(['rider']);
      expect(resolveCancelledRecipients({ cancelledBy: 'CANCELLED_BY_DRIVER' })).toEqual(['rider']);
    });

    it('pushes only to the assigned driver when the rider cancelled', () => {
      expect(resolvePushRecipients('RideCancelled', { cancelledBy: 'CANCELLED_BY_USER' })).toEqual([
        'assignedDriver',
      ]);
      expect(resolveCancelledRecipients({ cancelledBy: 'CANCELLED_BY_USER' })).toEqual(['assignedDriver']);
    });

    it('fails open to both recipients when cancelledBy is missing/unrecognized', () => {
      expect(resolveCancelledRecipients({})).toEqual(['rider', 'assignedDriver']);
      expect(resolveCancelledRecipients({ cancelledBy: 'something-unexpected' })).toEqual([
        'rider',
        'assignedDriver',
      ]);
    });
  });
});
