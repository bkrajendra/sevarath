import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../data/maps_repository.dart';
import '../models/route_models.dart';

/// A live GPS fix beyond this far from the route polyline counts as "off route".
const _offRouteThresholdMeters = 50.0;

/// Consecutive off-route readings required before triggering a reroute - avoids rerouting on a
/// single noisy GPS fix.
const _offRouteConfirmCount = 2;

/// How close to a maneuver's end before speaking its "alert" instruction (the turn is imminent).
const _maneuverAlertThresholdMeters = 30.0;

final flutterTtsProvider = Provider<FlutterTts>((ref) {
  final tts = FlutterTts();
  ref.onDispose(tts.stop);
  return tts;
});

final mapsRepositoryProvider = Provider<MapsRepository>((ref) => MapsRepository());

class NavigationState {
  const NavigationState({
    this.route,
    this.currentManeuverIndex = 0,
    this.remainingDistanceKm,
    this.remainingTimeSeconds,
    this.isOffRoute = false,
    this.isLoading = false,
    this.errorMessage,
  });

  final RouteInfo? route;
  final int currentManeuverIndex;
  final double? remainingDistanceKm;
  final double? remainingTimeSeconds;
  final bool isOffRoute;
  final bool isLoading;
  final String? errorMessage;

  RouteManeuver? get currentManeuver {
    final maneuvers = route?.maneuvers;
    if (maneuvers == null || currentManeuverIndex >= maneuvers.length) return null;
    return maneuvers[currentManeuverIndex];
  }

  NavigationState copyWith({
    RouteInfo? route,
    int? currentManeuverIndex,
    double? remainingDistanceKm,
    double? remainingTimeSeconds,
    bool? isOffRoute,
    bool? isLoading,
    String? errorMessage,
    bool clearError = false,
  }) {
    return NavigationState(
      route: route ?? this.route,
      currentManeuverIndex: currentManeuverIndex ?? this.currentManeuverIndex,
      remainingDistanceKm: remainingDistanceKm ?? this.remainingDistanceKm,
      remainingTimeSeconds: remainingTimeSeconds ?? this.remainingTimeSeconds,
      isOffRoute: isOffRoute ?? this.isOffRoute,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

/// Turn-by-turn guidance for the driver app (specification.md §3.4, plan.md Phase 6) - route
/// polyline + maneuver list from GET /maps/route (Valhalla), progress tracked against the
/// driver's own live GPS (independent of DriverLocationPusher's identical-looking but separate
/// stream - see that class's own doc comment on why these aren't shared), voice guidance via
/// flutter_tts, and automatic rerouting when the live position strays too far from the route.
class NavigationController extends Notifier<NavigationState> {
  StreamSubscription<Position>? _positionSub;
  LatLng? _destination;
  int _offRouteStreak = 0;
  final Set<int> _alertedManeuverIndices = {};

  @override
  NavigationState build() {
    ref.onDispose(() => _positionSub?.cancel());
    return const NavigationState();
  }

  Future<void> start(LatLng destination) async {
    _destination = destination;
    await _fetchRoute();
    _positionSub ??= Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 8),
    ).listen(_onPosition);
  }

  void stop() {
    _positionSub?.cancel();
    _positionSub = null;
    _destination = null;
    _offRouteStreak = 0;
    _alertedManeuverIndices.clear();
    state = const NavigationState();
  }

  Future<void> _fetchRoute({LatLng? origin}) async {
    final destination = _destination;
    if (destination == null) return;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      double originLat;
      double originLng;
      if (origin != null) {
        originLat = origin.latitude;
        originLng = origin.longitude;
      } else {
        final lastKnown = await Geolocator.getLastKnownPosition();
        originLat = lastKnown?.latitude ?? destination.latitude;
        originLng = lastKnown?.longitude ?? destination.longitude;
      }
      final route = await ref.read(mapsRepositoryProvider).getRoute(
            originLatitude: originLat,
            originLongitude: originLng,
            destinationLatitude: destination.latitude,
            destinationLongitude: destination.longitude,
          );
      _alertedManeuverIndices.clear();
      _offRouteStreak = 0;
      state = NavigationState(
        route: route,
        currentManeuverIndex: 0,
        remainingDistanceKm: route.lengthKm,
        remainingTimeSeconds: route.timeSeconds,
      );
      await _speak(route.maneuvers.isNotEmpty ? route.maneuvers.first.verbalPreTransitionInstruction : null);
    } on MapsException catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.message);
    }
  }

  void _onPosition(Position position) {
    final route = state.route;
    if (route == null || route.polyline.length < 2) return;
    final here = LatLng(position.latitude, position.longitude);

    // Find the closest segment on the whole polyline - a small campus route has at most a few
    // hundred points, cheap enough to scan fully on every GPS update (every ~8m of movement).
    var closestSegmentIndex = 0;
    var closestDistance = double.infinity;
    for (var i = 0; i < route.polyline.length - 1; i++) {
      final distance = distanceToSegmentMeters(here, route.polyline[i], route.polyline[i + 1]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSegmentIndex = i;
      }
    }

    if (closestDistance > _offRouteThresholdMeters) {
      _offRouteStreak++;
      if (_offRouteStreak >= _offRouteConfirmCount && !state.isOffRoute) {
        state = state.copyWith(isOffRoute: true);
        unawaited(_speak('Rerouting'));
        unawaited(_fetchRoute(origin: here));
      }
      return;
    }
    _offRouteStreak = 0;
    if (state.isOffRoute) {
      state = state.copyWith(isOffRoute: false);
    }

    // Which maneuver leg contains this segment - never move backward (GPS jitter near a
    // maneuver boundary shouldn't un-announce a turn already made).
    var maneuverIndex = state.currentManeuverIndex;
    for (var i = state.currentManeuverIndex; i < route.maneuvers.length; i++) {
      if (closestSegmentIndex >= route.maneuvers[i].beginShapeIndex) {
        maneuverIndex = i;
      }
    }

    if (maneuverIndex != state.currentManeuverIndex) {
      state = state.copyWith(currentManeuverIndex: maneuverIndex);
      final maneuver = route.maneuvers[maneuverIndex];
      unawaited(_speak(maneuver.verbalPreTransitionInstruction ?? maneuver.instruction));
    }

    final maneuver = state.currentManeuver;
    if (maneuver != null) {
      final endPoint = route.polyline[maneuver.endShapeIndex.clamp(0, route.polyline.length - 1)];
      final distanceToManeuverEnd = haversineMeters(here, endPoint);
      if (distanceToManeuverEnd <= _maneuverAlertThresholdMeters &&
          _alertedManeuverIndices.add(maneuverIndex)) {
        unawaited(_speak(maneuver.verbalTransitionAlertInstruction ?? maneuver.instruction));
      }
    }

    // Remaining distance/time: sum of every not-yet-reached maneuver leg, matching Valhalla's
    // own per-maneuver length/time rather than re-deriving it from raw polyline geometry.
    var remainingKm = 0.0;
    var remainingSeconds = 0.0;
    for (var i = maneuverIndex; i < route.maneuvers.length; i++) {
      remainingKm += route.maneuvers[i].length;
      remainingSeconds += route.maneuvers[i].time;
    }
    state = state.copyWith(remainingDistanceKm: remainingKm, remainingTimeSeconds: remainingSeconds);
  }

  Future<void> _speak(String? text) async {
    if (text == null || text.isEmpty) return;
    await ref.read(flutterTtsProvider).speak(text);
  }
}

final navigationControllerProvider = NotifierProvider<NavigationController, NavigationState>(
  NavigationController.new,
);
