import { Injectable, Logger, Inject } from '@nestjs/common';
import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { drivers, vehicles, type Driver } from '../db/schema';

export interface PickupPoint {
  latitude: number;
  longitude: number;
}

export type DriverCandidate = Driver & { distanceMeters: number };

/**
 * How stale a driver's last-pushed `current_latitude`/`current_longitude` snapshot may be
 * before it's no longer trusted for matching. There is no doc-specified value for this (it's a
 * product-tuning knob, not a spec requirement) - 5 minutes was picked as a sane default: long
 * enough to tolerate a driver app's push cadence (specification.md §6: ~3-15s while
 * moving/stationary) plus some backgrounding/network jitter, short enough that a driver who
 * went properly offline without updating availability doesn't get offered rides for hours.
 * See docs/open-items.md for the recorded decision - revisit once Phase 5's live Redis location
 * pipeline exists and dispatch can use a fresher source. Named here, not hardcoded inline.
 */
export const LOCATION_STALENESS_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class DriverMatcherService {
  private readonly logger = new Logger(DriverMatcherService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Finds AVAILABLE, ACTIVE drivers with an AVAILABLE assigned vehicle and a fresh-enough
   * location, ordered nearest-first to `pickup` via a plain-SQL Haversine formula (no PostGIS -
   * see architecture.md §4.2 and docs/open-items.md #2).
   *
   * Deliberately skips the "inside the campus geofence" filter architecture.md §4.2 also
   * describes - there is no campus geofence data reachable without PostGIS in this environment
   * (docs/open-items.md #1), so it's left for later PostGIS/`campus_restricted_zones`
   * integration (see docs/open-items.md).
   */
  async findCandidates(
    pickup: PickupPoint,
    excludeDriverIds: string[] = [],
  ): Promise<DriverCandidate[]> {
    const staleBefore = new Date(Date.now() - LOCATION_STALENESS_WINDOW_MS);

    // 6371000 = Earth's mean radius in meters.
    const distanceMeters = sql<number>`6371000 * acos(
      least(1, greatest(-1,
        cos(radians(${pickup.latitude})) * cos(radians(${drivers.currentLatitude})) *
          cos(radians(${drivers.currentLongitude}) - radians(${pickup.longitude})) +
        sin(radians(${pickup.latitude})) * sin(radians(${drivers.currentLatitude}))
      ))
    )`;

    const conditions = [
      eq(drivers.availability, 'AVAILABLE'),
      eq(drivers.status, 'ACTIVE'),
      isNotNull(drivers.currentVehicleId),
      isNotNull(drivers.currentLatitude),
      isNotNull(drivers.currentLongitude),
      sql`${drivers.locationUpdatedAt} IS NOT NULL AND ${drivers.locationUpdatedAt} >= ${staleBefore}`,
      eq(vehicles.status, 'AVAILABLE'),
    ];

    if (excludeDriverIds.length > 0) {
      conditions.push(notInArray(drivers.id, excludeDriverIds));
    }

    const rows = await this.db
      .select({
        driver: drivers,
        distanceMeters,
      })
      .from(drivers)
      .innerJoin(vehicles, eq(vehicles.id, drivers.currentVehicleId))
      .where(and(...conditions))
      .orderBy(sql`${distanceMeters} asc`);

    return rows.map((row) => ({ ...row.driver, distanceMeters: Number(row.distanceMeters) }));
  }
}
