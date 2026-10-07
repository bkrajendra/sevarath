import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Shape of a driver's live location as cached in Redis. Field list matches
 * specification.md §6 exactly (`latitude, longitude, heading, speed, accuracy, timestamp`),
 * with `timestamp` named `recordedAt` here to avoid colliding with JS's `Date`/`timestamp`
 * ambiguity and to match the WS event payload this task also defines.
 */
export interface DriverLocationRecord {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** ISO-8601 string - when the driver's device captured this fix (not when we cached it). */
  recordedAt: string;
}

export interface LocationUpdateResult {
  accepted: boolean;
  /** Present only when accepted === false. */
  reason?: 'low_accuracy';
}

/**
 * TTL for a cached driver location (specification.md §6: driver apps push every ~3-5s while
 * moving, ~10-15s while stationary). 45s = 3x the slowest documented cadence (15s), so a
 * driver who misses a couple of beats (normal network jitter/backgrounding) doesn't drop out
 * of "currently trackable" status, but one who genuinely stops pushing (app killed, socket
 * disconnected and never reconnects) ages out of the cache well within a minute - no explicit
 * cleanup job needed. Deliberately much shorter than `LOCATION_STALENESS_WINDOW_MS` (5 minutes,
 * driver-matcher.service.ts) - that constant governs the much coarser/less-frequently-updated
 * DB snapshot (open-items.md #11), not this high-frequency live cache; the two are allowed to
 * disagree because they serve different consumers (live rider-facing tracking vs. dispatch's
 * cold-start matching tolerance).
 */
export const DRIVER_LOCATION_CACHE_TTL_SECONDS = 45;

/**
 * Accuracy threshold (specification.md §6, default stated there is 100m): a new reading whose
 * `accuracy` (GPS horizontal accuracy in meters; smaller = better) is worse than this is
 * "low-quality" and must not silently overwrite a good last-known position once one exists.
 * Named constant, not a magic number, same style as `LOCATION_STALENESS_WINDOW_MS`.
 */
export const LOCATION_ACCURACY_THRESHOLD_METERS = 100;

/**
 * Pure accuracy-filter decision (specification.md §6), isolated from Redis so it's trivially
 * unit-testable: should a new reading with the given `accuracy` be accepted (written/forwarded)
 * given whether a cached (non-expired) location already exists for this driver?
 *
 * - Missing/undefined `accuracy` (an older client that doesn't report it) is treated as
 *   *trusted*, not low-quality: the accuracy threshold exists to stop a *known-bad* fix from
 *   clobbering a known-good one, and the absence of an accuracy figure is not evidence the fix
 *   is bad - treating it as untrusted would effectively freeze a driver's tracked position
 *   forever on any device/OS combination that never reports horizontal accuracy, which is a
 *   worse outcome than occasionally accepting an unqualified fix.
 * - A reading worse than the threshold is accepted only when there is nothing cached yet (first
 *   fix ever, or the previous one already expired) - a known-crude starting position beats no
 *   position at all, per the task's own framing.
 */
export function isAcceptableLocationReading(
  accuracy: number | undefined,
  hasExistingCachedLocation: boolean,
): boolean {
  if (accuracy === undefined) {
    return true;
  }
  if (accuracy <= LOCATION_ACCURACY_THRESHOLD_METERS) {
    return true;
  }
  return !hasExistingCachedLocation;
}

function driverLocationKey(driverId: string): string {
  return `driver:location:${driverId}`;
}

/**
 * The *only* place that knows the `driver:location:<driverId>` Redis key format (per this
 * task's brief) - nothing else should construct that string directly.
 *
 * Uses its own dedicated `ioredis` client, parsed from `REDIS_URL` the same way
 * `redis-io.adapter.ts` does. It cannot reuse that file's pub/sub clients - a client in Redis
 * subscribe mode can't also issue ordinary `GET`/`SET` commands - so this is a third, separate
 * `ioredis` connection (alongside the socket.io adapter's pub/sub pair and BullMQ's own).
 */
@Injectable()
export class LocationCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(LocationCacheService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const redisUrl = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
    this.client = new Redis({ host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 });
  }

  /** Unconditionally writes `record` for `driverId`, with the TTL above. */
  async setLocation(driverId: string, record: DriverLocationRecord): Promise<void> {
    await this.client.set(
      driverLocationKey(driverId),
      JSON.stringify(record),
      'EX',
      DRIVER_LOCATION_CACHE_TTL_SECONDS,
    );
  }

  /** Reads back `driverId`'s cached location, or `null` if absent/expired/corrupt. */
  async getLocation(driverId: string): Promise<DriverLocationRecord | null> {
    const raw = await this.client.get(driverLocationKey(driverId));
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as DriverLocationRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Corrupt cached location JSON for driver ${driverId}, treating as absent: ${message}`);
      return null;
    }
  }

  /**
   * Applies the accuracy filter (reading the current cache to know whether something's already
   * there) and, if accepted, writes `record`. This is the single entry point callers (the
   * gateway) should use for an incoming push - it owns both "read existing" and "decide/write"
   * so there's no window for a caller to race its own read against its own write.
   */
  async trySetLocation(driverId: string, record: DriverLocationRecord): Promise<LocationUpdateResult> {
    const existing = await this.getLocation(driverId);
    if (!isAcceptableLocationReading(record.accuracy, existing !== null)) {
      this.logger.debug(
        `Dropping low-quality location for driver ${driverId}: accuracy=${record.accuracy}m ` +
          `exceeds ${LOCATION_ACCURACY_THRESHOLD_METERS}m threshold and a good last-known ` +
          'position is already cached - not overwriting it.',
      );
      return { accepted: false, reason: 'low_accuracy' };
    }

    await this.setLocation(driverId, record);
    return { accepted: true };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
