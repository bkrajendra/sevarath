/**
 * Who gets notified in real time for each ride-domain `eventType` flowing through the
 * `domain-events` outbox queue (architecture.md §4.3), as consumed by
 * `DomainEventRealtimeConsumer`. This table is the single place that decision lives - see
 * docs/open-items.md #3/#22 for how each row was derived from the actual outbox call sites in
 * `rides.service.ts`/`dispatch.service.ts`/`assignment.service.ts`.
 *
 * Recipients:
 * - 'rider': the ride's rider, looked up as `rides.userId`.
 * - 'assignedDriver': the ride's *currently assigned* driver, `rides.driverId` - may be null
 *   (e.g. cancelled before any driver was ever assigned), which the consumer treats as a no-op,
 *   not a routing error.
 * - 'offeredDriver': the specific driver named in the event's own payload
 *   (`payload.driverId`) - deliberately NOT `rides.driverId`, since for `RideDriverNotified`
 *   that driver has only been offered the ride, not yet accepted it (ride.driverId isn't set
 *   until RideAssigned).
 *
 * An eventType mapped to `[]` reaches nobody *by design* - either the rider already has this
 * synchronously from the originating HTTP response (`RideRequested`), or it is purely internal
 * bookkeeping (`RideSearchingDriver`). An eventType with no entry at all here is unexpected (not
 * one of the strings this table knows about) - the consumer logs and drops it rather than
 * guessing or crashing the worker.
 *
 * WebSocket event naming: the event emitted to the client is the exact same string as the
 * domain `eventType` (e.g. `'RideAssigned'`), not architecture.md §6.1's illustrative
 * lowercase-dot names (`ride.assigned`, etc. - that section explicitly describes those as
 * illustrative, not a literal contract). This keeps one straight line from the `ride_events`/
 * `outbox_events` audit trail through to what a client actually receives, which is simpler to
 * debug than maintaining a second, parallel naming scheme. Documented decision - see
 * docs/open-items.md.
 */
export type RideEventRecipient = 'rider' | 'assignedDriver' | 'offeredDriver';

export const RIDE_EVENT_ROUTING: Readonly<Record<string, readonly RideEventRecipient[]>> = Object.freeze({
  // The rider already has this synchronously from the POST /rides HTTP response.
  RideRequested: [],
  // Internal bookkeeping only. NOTE: rides.service.ts#create never actually writes this
  // eventType to the outbox (only 'RideRequested' is outboxed there - see rides.service.ts) so
  // the consumer will not see this eventType in practice today; kept here so the table stays an
  // accurate, complete statement of intent rather than silently omitting it.
  RideSearchingDriver: [],
  RideDriverNotified: ['offeredDriver'],
  RideAssigned: ['rider', 'assignedDriver'],
  RideCancelled: ['rider', 'assignedDriver'],
  RideNoDriverAvailable: ['rider'],
  // The driver already knows - they're the one who tapped the button.
  DriverArrived: ['rider'],
  RideStarted: ['rider'],
  RideCompleted: ['rider'],
});
