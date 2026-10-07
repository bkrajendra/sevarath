import type { RideEventRecipient } from '../events/consumers/ride-event-routing';

export interface NotificationCopy {
  title: string;
  body: string;
}

/**
 * Title/body copy per ride-domain `eventType`, for the recipient role actually being notified
 * (only `RideCancelled` differs by recipient - see `push-recipients.ts`). Returns `null` for an
 * eventType this table has no copy for (e.g. one that maps to no push recipients at all, or an
 * eventType the routing table doesn't know about) - the consumer treats that as "nothing to
 * send", not an error.
 */
export function buildNotificationCopy(
  eventType: string,
  recipient: RideEventRecipient,
): NotificationCopy | null {
  switch (eventType) {
    case 'RideDriverNotified':
      return {
        title: 'New ride request nearby',
        body: 'A rider nearby needs a ride. Open the app to respond before the offer expires.',
      };
    case 'RideAssigned':
      return {
        title: 'Driver on the way',
        body: 'A driver has been assigned to your ride and is heading your way.',
      };
    case 'RideCancelled':
      return recipient === 'rider'
        ? { title: 'Ride cancelled', body: 'Your driver cancelled the ride.' }
        : { title: 'Ride cancelled', body: 'The rider cancelled the ride.' };
    case 'RideNoDriverAvailable':
      return {
        title: 'No drivers available',
        body: "We couldn't find a driver nearby right now. Please try again shortly.",
      };
    case 'DriverArrived':
      return {
        title: 'Your driver has arrived',
        body: 'Your driver is waiting for you at the pickup point.',
      };
    case 'RideStarted':
      return {
        title: 'Ride started',
        body: 'Your ride is now in progress.',
      };
    case 'RideCompleted':
      return {
        title: 'Ride completed',
        body: 'Thanks for riding with us - your ride is complete.',
      };
    default:
      return null;
  }
}
