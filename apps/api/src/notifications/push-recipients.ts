import type { RideEventRecipient } from '../events/consumers/ride-event-routing';

/**
 * Which ride-domain `eventType`s warrant a *push* notification, and to whom - deliberately a
 * separate table from `events/consumers/ride-event-routing.ts`'s `RIDE_EVENT_ROUTING` (the
 * WebSocket routing table), not a reuse of it. Reasoning (docs/open-items.md): a push firing
 * while the app is foregrounded and already live-updating over the WebSocket is redundant
 * noise - the whole point of push is reaching a backgrounded/killed app. Two real divergences
 * from the WS table:
 *
 * 1. `RideAssigned` pushes only to the **rider**, not the driver who was just assigned - that
 *    driver is the one who tapped "accept" on their own device a moment ago; they already know.
 *    The WS table pushes to both because a connected driver socket should still see its own
 *    room update (e.g. to drive UI state), but a *push* for an action you just took yourself
 *    is exactly the kind of noise this table exists to avoid.
 * 2. `RideCancelled` has no static entry here at all - see `resolveCancelledRecipients` below.
 *    Unlike every WS-routed event, who should be pushed depends on *who cancelled*, which the
 *    outbox payload's `cancelledBy` field already carries (`rides.service.ts#cancel`) - the
 *    whole point of a cancellation push is reaching the party who did NOT initiate it (the
 *    one who *did* cancel already knows, they tapped the button).
 *
 * `RideDriverNotified` is pushed to the offered driver because that's the single clearest case
 * where push matters most: a driver's app may well be backgrounded while idling, waiting for
 * ride offers, and the 15s acceptance window (architecture.md §4.2) means a missed foreground
 * notification could cost them the offer entirely.
 *
 * `RideRequested`/`RideSearchingDriver` push to nobody, same reasoning as the WS table (rider
 * already has `RideRequested` synchronously from the HTTP response; `RideSearchingDriver` is
 * internal bookkeeping that isn't even outboxed today).
 */
export const PUSH_EVENT_ROUTING: Readonly<Record<string, readonly RideEventRecipient[]>> = Object.freeze({
  RideRequested: [],
  RideSearchingDriver: [],
  RideDriverNotified: ['offeredDriver'],
  // WS-only for the assigned driver - see class comment above.
  RideAssigned: ['rider'],
  RideNoDriverAvailable: ['rider'],
  // The driver already knows - they're the one who tapped the button (same reasoning the WS
  // table uses for this event).
  DriverArrived: ['rider'],
  RideStarted: ['rider'],
  RideCompleted: ['rider'],
  // RideCancelled is deliberately absent - see resolveCancelledRecipients.
});

/**
 * `RideCancelled`'s push recipient is whoever did NOT initiate the cancellation, derived from
 * the outbox payload's `cancelledBy` field (`'CANCELLED_BY_USER'` | `'CANCELLED_BY_DRIVER'`,
 * set unconditionally by `rides.service.ts#cancel`). The cancelling party already knows; the
 * other party is exactly who a backgrounded-app push needs to reach.
 */
export function resolveCancelledRecipients(payload: Record<string, unknown>): RideEventRecipient[] {
  if (payload.cancelledBy === 'CANCELLED_BY_DRIVER') {
    return ['rider'];
  }
  if (payload.cancelledBy === 'CANCELLED_BY_USER') {
    return ['assignedDriver'];
  }
  // Shouldn't happen in practice (rides.service.ts always sets cancelledBy) - fail open to
  // "notify both" rather than silently notifying nobody.
  return ['rider', 'assignedDriver'];
}

/** The full recipient list for a given eventType/payload - the one function the consumer calls. */
export function resolvePushRecipients(
  eventType: string,
  payload: Record<string, unknown>,
): readonly RideEventRecipient[] {
  if (eventType === 'RideCancelled') {
    return resolveCancelledRecipients(payload);
  }
  return PUSH_EVENT_ROUTING[eventType] ?? [];
}
