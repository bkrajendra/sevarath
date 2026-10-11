import 'package:maplibre_gl/maplibre_gl.dart';

/// Single source of truth for the campus center/service-area constants used across the map
/// preview, ride booking, and (eventually) any other screen that needs to reason about "is this
/// point on campus" - previously only existed as an inlined default parameter value in
/// `campus_map_preview.dart`.
class CampusConfig {
  CampusConfig._();

  /// Diamond Hall Shanti Van, Abu Road - the actual campus this app is built for (matches
  /// `apps/api/src/db/seed.ts`'s own named-location entry for this exact building, and the
  /// admin app's `useMapLibreMap.ts#DEFAULT_MAP_CENTER`).
  static const LatLng center = LatLng(24.5313075, 72.7947805);

  /// A circular approximation of the service area, not the real campus boundary polygon (that
  /// only exists server-side, in `campus_boundaries` - driver-matcher.service.ts - with no public
  /// API exposing it to this app yet). The seeded campus_locations span roughly 500m across
  /// (apps/api/src/db/seed.ts), so this leaves a generous buffer for GPS inaccuracy and the
  /// campus edges while still catching "this device is nowhere near campus" (found in live
  /// testing, 2026-10-12: a closed location-mocking app left a stale/unrelated GPS fix, and the
  /// booking flow had no way to tell the rider why nothing was working).
  static const double serviceRadiusMeters = 2000;
}
