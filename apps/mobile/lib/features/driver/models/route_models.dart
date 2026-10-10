import 'package:maplibre_gl/maplibre_gl.dart';

/// Mirrors apps/api/src/maps/dto/route-response.dto.ts's RouteManeuverResponseDto. The three
/// `verbal*` fields are Valhalla's own text written specifically for speech (shorter/more
/// natural than `instruction`, which is the visual-banner text) - see navigation_provider.dart
/// for how each is used.
class RouteManeuver {
  const RouteManeuver({
    required this.instruction,
    this.verbalPreTransitionInstruction,
    this.verbalTransitionAlertInstruction,
    this.verbalPostTransitionInstruction,
    required this.length,
    required this.time,
    required this.beginShapeIndex,
    required this.endShapeIndex,
  });

  final String instruction;
  final String? verbalPreTransitionInstruction;
  final String? verbalTransitionAlertInstruction;
  final String? verbalPostTransitionInstruction;

  /// Kilometers.
  final double length;

  /// Seconds.
  final double time;

  /// Index into the decoded polyline (RouteInfo.polyline) where this maneuver's leg starts/ends.
  final int beginShapeIndex;
  final int endShapeIndex;

  factory RouteManeuver.fromJson(Map<String, dynamic> json) {
    return RouteManeuver(
      instruction: json['instruction'] as String,
      verbalPreTransitionInstruction: json['verbalPreTransitionInstruction'] as String?,
      verbalTransitionAlertInstruction: json['verbalTransitionAlertInstruction'] as String?,
      verbalPostTransitionInstruction: json['verbalPostTransitionInstruction'] as String?,
      length: (json['length'] as num).toDouble(),
      time: (json['time'] as num).toDouble(),
      beginShapeIndex: json['beginShapeIndex'] as int,
      endShapeIndex: json['endShapeIndex'] as int,
    );
  }
}

/// Mirrors RouteResponseDto - `shape` arrives as an encoded polyline (Valhalla's default 1e6
/// precision, NOT the common 1e5 Google-polyline precision - see maps_repository.dart's decoder)
/// and is decoded once here into real coordinates.
class RouteInfo {
  const RouteInfo({
    required this.polyline,
    required this.lengthKm,
    required this.timeSeconds,
    required this.maneuvers,
  });

  final List<LatLng> polyline;
  final double lengthKm;
  final double timeSeconds;
  final List<RouteManeuver> maneuvers;
}
