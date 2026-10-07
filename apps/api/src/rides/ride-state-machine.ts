import { ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../db/drizzle.module';
import { rides, type Ride } from '../db/schema';

export type RideStatus = Ride['status'];

/**
 * The full ride transition table - see specification.md §5 (Ride State Machine diagram)
 * reconciled with specification.md §8 (Error & Edge Case Handling).
 *
 * This is pure data + pure functions, deliberately with no NestJS DI, so other modules
 * (e.g. a future Dispatch module) can import it as plain TS without creating a circular
 * module dependency on RidesModule.
 *
 * See docs/open-items.md for the exact reasoning behind two judgment calls baked into this
 * table: (a) RIDE_STARTED/DRIVER_EN_ROUTE_TO_DESTINATION are not cancellable (specification.md
 * §5's cancellable-states list stops at DRIVER_ARRIVED), and (b) CANCELLED_BY_DRIVER is modeled
 * as terminal here rather than looping back to SEARCHING_DRIVER, even though specification.md
 * §8's edge-case table describes the friendlier "returns to dispatch" behavior - real
 * re-dispatch-on-driver-cancel needs the (not-yet-built) Dispatch module and is deferred.
 */
export const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  REQUESTED: ['SEARCHING_DRIVER', 'CANCELLED_BY_USER', 'CANCELLED_BY_SYSTEM'],
  SEARCHING_DRIVER: [
    'DRIVER_ASSIGNED',
    'NO_DRIVER_AVAILABLE',
    'CANCELLED_BY_USER',
    'CANCELLED_BY_SYSTEM',
  ],
  DRIVER_ASSIGNED: [
    'DRIVER_EN_ROUTE_TO_PICKUP',
    'CANCELLED_BY_USER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_SYSTEM',
  ],
  DRIVER_EN_ROUTE_TO_PICKUP: [
    'DRIVER_ARRIVED',
    'CANCELLED_BY_USER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_SYSTEM',
  ],
  DRIVER_ARRIVED: [
    'RIDE_STARTED',
    'CANCELLED_BY_USER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_SYSTEM',
  ],
  // Not cancellable once the ride has physically started - matches specification.md §5's
  // cancellable-states list, which stops at DRIVER_ARRIVED.
  RIDE_STARTED: ['DRIVER_EN_ROUTE_TO_DESTINATION', 'COMPLETED'],
  DRIVER_EN_ROUTE_TO_DESTINATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED_BY_USER: [],
  CANCELLED_BY_DRIVER: [],
  CANCELLED_BY_SYSTEM: [],
  NO_DRIVER_AVAILABLE: [],
};

/** Pure check against RIDE_TRANSITIONS - for *callers* to decide what's even worth attempting. */
export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The set of statuses from which a ride may still be cancelled (by user or driver). */
export const CANCELLABLE_RIDE_STATUSES: RideStatus[] = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_PICKUP',
  'DRIVER_ARRIVED',
];

/** Maps a target ride status to the dedicated timestamp column `applyRideTransition` should stamp. */
const TIMESTAMP_COLUMN_BY_STATUS: Partial<Record<RideStatus, keyof typeof rides.$inferInsert>> = {
  DRIVER_ASSIGNED: 'acceptedAt',
  DRIVER_ARRIVED: 'driverArrivedAt',
  RIDE_STARTED: 'startedAt',
  COMPLETED: 'completedAt',
  CANCELLED_BY_USER: 'cancelledAt',
  CANCELLED_BY_DRIVER: 'cancelledAt',
  CANCELLED_BY_SYSTEM: 'cancelledAt',
};

export class RideTransitionConflictException extends ConflictException {
  constructor(
    rideId: string,
    attemptedStatus: RideStatus,
    code = 'RIDE_TRANSITION_CONFLICT',
  ) {
    super({ code, rideId, attemptedStatus });
  }
}

/**
 * The single concurrency-safe primitive every ride state change in this system goes through
 * (including ones a future Dispatch module adds, e.g. the driver-accept race from
 * architecture.md §4.2). One atomic SQL statement:
 *
 *   UPDATE rides SET status = toStatus, updated_at = now(), <timestamp col>, ...extraSet
 *   WHERE id = rideId AND status IN (fromStatuses)
 *   RETURNING *
 *
 * If zero rows come back, the ride was not in one of `fromStatuses` any more (lost a race, or
 * the caller attempted an invalid transition) - throws RideTransitionConflictException rather
 * than silently doing nothing.
 *
 * Deliberately does NOT re-validate against canTransition()/RIDE_TRANSITIONS itself - the
 * whole point is that the database (via the WHERE ... IN (fromStatuses) guard) is the single
 * arbiter under concurrency. canTransition/RIDE_TRANSITIONS exists for callers to decide what
 * fromStatuses are even worth attempting (e.g. rejecting an obviously-invalid request with a
 * clean 400 before hitting the DB), not for this function to re-check.
 */
export async function applyRideTransition(
  tx: DrizzleDb,
  rideId: string,
  fromStatuses: RideStatus[],
  toStatus: RideStatus,
  extraSet: Partial<typeof rides.$inferInsert> = {},
  conflictCode?: string,
): Promise<Ride> {
  const timestampColumn = TIMESTAMP_COLUMN_BY_STATUS[toStatus];

  const [updated] = await tx
    .update(rides)
    .set({
      status: toStatus,
      updatedAt: new Date(),
      ...(timestampColumn ? { [timestampColumn]: new Date() } : {}),
      ...extraSet,
    })
    .where(and(eq(rides.id, rideId), inArray(rides.status, fromStatuses)))
    .returning();

  if (!updated) {
    throw new RideTransitionConflictException(rideId, toStatus, conflictCode);
  }

  return updated;
}
