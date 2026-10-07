import {
  isAcceptableLocationReading,
  LOCATION_ACCURACY_THRESHOLD_METERS,
} from './location-cache.service';

/**
 * Unit tests for the pure accuracy-filtering decision (specification.md §6), isolated from
 * Redis entirely - this proves the actual comparison logic
 * (`accuracy` vs. `LOCATION_ACCURACY_THRESHOLD_METERS`, combined with whether something's
 * already cached), not just that some function got called. The real-Redis round-trip through
 * `LocationCacheService.trySetLocation`/`getLocation` is covered by
 * `test/driver-location.e2e-spec.ts` instead.
 */
describe('isAcceptableLocationReading', () => {
  it('always accepts a good-accuracy reading, whether or not something is already cached', () => {
    expect(isAcceptableLocationReading(5, false)).toBe(true);
    expect(isAcceptableLocationReading(5, true)).toBe(true);
    expect(isAcceptableLocationReading(LOCATION_ACCURACY_THRESHOLD_METERS, true)).toBe(true);
  });

  it('accepts a bad-accuracy reading when nothing is cached yet (first fix ever, or expired)', () => {
    expect(isAcceptableLocationReading(LOCATION_ACCURACY_THRESHOLD_METERS + 1, false)).toBe(true);
    expect(isAcceptableLocationReading(5000, false)).toBe(true);
  });

  it('drops a bad-accuracy reading when a good last-known position is already cached', () => {
    expect(isAcceptableLocationReading(LOCATION_ACCURACY_THRESHOLD_METERS + 1, true)).toBe(false);
    expect(isAcceptableLocationReading(5000, true)).toBe(false);
  });

  it('treats a missing accuracy as trusted (accepted) regardless of what is cached', () => {
    expect(isAcceptableLocationReading(undefined, false)).toBe(true);
    expect(isAcceptableLocationReading(undefined, true)).toBe(true);
  });
});
