import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import {
  driverAvailabilityEnum,
  drivers,
  rides,
  vehicleStatusEnum,
  vehicles,
  type Ride,
} from '../db/schema';
import { RIDE_TRANSITIONS, type RideStatus } from '../rides/ride-state-machine';
import type { AdminListRidesQueryDto } from './dto/admin-list-rides-query.dto';

/**
 * Terminal ride statuses, *derived* from RIDE_TRANSITIONS (rides/ride-state-machine.ts) rather
 * than a second, independently-maintained list - same technique
 * locations/location.gateway.ts's TERMINAL_RIDE_STATUSES already uses (docs/open-items.md #29).
 * A status is terminal exactly when it has no outgoing transitions.
 */
const TERMINAL_RIDE_STATUSES: RideStatus[] = (Object.keys(RIDE_TRANSITIONS) as RideStatus[]).filter(
  (status) => RIDE_TRANSITIONS[status].length === 0,
);

export type VehicleStatus = (typeof vehicleStatusEnum.enumValues)[number];
export type DriverAvailability = (typeof driverAvailabilityEnum.enumValues)[number];

export interface DashboardSummary {
  vehiclesByStatus: Record<VehicleStatus, number>;
  driversByAvailability: Record<DriverAvailability, number>;
  activeRidesCount: number;
}

export interface LiveMapDriverRow {
  driverId: string;
  driverCode: string;
  availability: DriverAvailability;
  latitude: number;
  longitude: number;
  locationUpdatedAt: Date | null;
  activeRideId: string | null;
  activeRideStatus: RideStatus | null;
}

/** Admin cross-cutting operational views (dashboard, campus-wide rides search, live map) - plan.md Phase 8. */
@Injectable()
export class AdminService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** specification.md §9 - vehicle/driver counts by status plus an active-rides count. */
  async getDashboardSummary(): Promise<DashboardSummary> {
    const [vehicleCountRows, driverCountRows, [activeRidesRow]] = await Promise.all([
      this.db
        .select({ status: vehicles.status, count: sql<string>`count(*)` })
        .from(vehicles)
        .groupBy(vehicles.status),
      this.db
        .select({ availability: drivers.availability, count: sql<string>`count(*)` })
        .from(drivers)
        .groupBy(drivers.availability),
      this.db
        .select({ count: sql<string>`count(*)` })
        .from(rides)
        .where(notInArray(rides.status, TERMINAL_RIDE_STATUSES)),
    ]);

    const vehiclesByStatus = Object.fromEntries(
      vehicleStatusEnum.enumValues.map((status) => [status, 0]),
    ) as Record<VehicleStatus, number>;
    for (const row of vehicleCountRows) {
      vehiclesByStatus[row.status] = Number(row.count);
    }

    const driversByAvailability = Object.fromEntries(
      driverAvailabilityEnum.enumValues.map((availability) => [availability, 0]),
    ) as Record<DriverAvailability, number>;
    for (const row of driverCountRows) {
      driversByAvailability[row.availability] = Number(row.count);
    }

    return {
      vehiclesByStatus,
      driversByAvailability,
      activeRidesCount: Number(activeRidesRow?.count ?? 0),
    };
  }

  /** specification.md §9 - "Ride history / search", campus-wide (not scoped to one caller). */
  async listRides(query: AdminListRidesQueryDto): Promise<{ items: Ride[]; total: number }> {
    const conditions = [];
    if (query.status) conditions.push(eq(rides.status, query.status));
    if (query.userId) conditions.push(eq(rides.userId, query.userId));
    if (query.driverId) conditions.push(eq(rides.driverId, query.driverId));
    if (query.requestedAfter) conditions.push(gte(rides.requestedAt, new Date(query.requestedAfter)));
    if (query.requestedBefore) conditions.push(lte(rides.requestedAt, new Date(query.requestedBefore)));

    // and(...[]) is undefined in drizzle-orm, and .where(undefined) is a no-op - the standard
    // way to build an optionally-filtered query without a second branch per condition count.
    const where = and(...conditions);

    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(rides)
        .where(where)
        .orderBy(desc(rides.requestedAt))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ count: sql<string>`count(*)` }).from(rides).where(where),
    ]);

    return { items, total: Number(totalRows[0]?.count ?? 0) };
  }

  /**
   * specification.md §9 - "Live campus map with EV positions", scoped down to the underlying
   * data (no rendered map here - see docs/open-items.md for the full reasoning): every driver
   * with a location snapshot, their availability, when that snapshot was taken, and their
   * current ride if one is assigned.
   */
  async getLiveMap(): Promise<LiveMapDriverRow[]> {
    const driverRows = await this.db
      .select({
        driverId: drivers.id,
        driverCode: drivers.driverCode,
        availability: drivers.availability,
        latitude: drivers.currentLatitude,
        longitude: drivers.currentLongitude,
        locationUpdatedAt: drivers.locationUpdatedAt,
      })
      .from(drivers)
      .where(and(isNotNull(drivers.currentLatitude), isNotNull(drivers.currentLongitude)));

    if (driverRows.length === 0) {
      return [];
    }

    const driverIds = driverRows.map((row) => row.driverId);
    const activeRideRows = await this.db
      .select({ id: rides.id, driverId: rides.driverId, status: rides.status })
      .from(rides)
      .where(and(inArray(rides.driverId, driverIds), notInArray(rides.status, TERMINAL_RIDE_STATUSES)))
      .orderBy(desc(rides.requestedAt));

    // A driver should have at most one non-terminal ride at a time (atomic assignment - unlike
    // the user side, there is no equivalent of docs/open-items.md #28 observed for drivers), but
    // this takes the most recently requested one defensively rather than assuming that holds.
    const activeRideByDriver = new Map<string, { id: string; status: RideStatus }>();
    for (const row of activeRideRows) {
      if (row.driverId && !activeRideByDriver.has(row.driverId)) {
        activeRideByDriver.set(row.driverId, { id: row.id, status: row.status });
      }
    }

    return driverRows.map((driver) => {
      const activeRide = activeRideByDriver.get(driver.driverId);
      return {
        driverId: driver.driverId,
        driverCode: driver.driverCode,
        availability: driver.availability,
        // Non-null by the WHERE clause above.
        latitude: driver.latitude as number,
        longitude: driver.longitude as number,
        locationUpdatedAt: driver.locationUpdatedAt,
        activeRideId: activeRide?.id ?? null,
        activeRideStatus: activeRide?.status ?? null,
      };
    });
  }
}
