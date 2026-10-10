import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/ride_socket_service.dart';
import '../data/rides_repository.dart';
import '../models/ride.dart';

class RideState {
  const RideState({this.ride, this.driverLocation, this.isRequesting = false, this.errorMessage});

  final Ride? ride;
  final DriverLocationUpdate? driverLocation;
  final bool isRequesting;
  final String? errorMessage;

  RideState copyWith({
    Ride? ride,
    bool clearRide = false,
    DriverLocationUpdate? driverLocation,
    bool? isRequesting,
    String? errorMessage,
    bool clearError = false,
  }) {
    return RideState(
      ride: clearRide ? null : (ride ?? this.ride),
      driverLocation: driverLocation ?? this.driverLocation,
      isRequesting: isRequesting ?? this.isRequesting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

final ridesRepositoryProvider = Provider<RidesRepository>((ref) => RidesRepository());

/// A single past (or current) ride by id - for RideDetailsScreen opening a history entry that
/// isn't RideController's own currently-tracked ride.
final rideByIdProvider = FutureProvider.family<Ride, String>((ref, id) {
  return ref.read(ridesRepositoryProvider).getRide(id);
});

/// The rider's ride history (GET /rides/history) - RidesScreen's real data source.
final rideHistoryProvider = FutureProvider<List<Ride>>((ref) {
  return ref.read(ridesRepositoryProvider).getHistory();
});
final rideSocketServiceProvider = Provider<RideSocketService>((ref) {
  final service = RideSocketService();
  ref.onDispose(service.dispose);
  return service;
});

/// Owns the rider's current ride end to end: creates it, keeps it in sync with the backend via
/// the `/ws` gateway (falling back to nothing fancier than "re-fetch over REST" on every
/// relevant event, per that gateway's own documented design - see ride_socket_service.dart),
/// and exposes live driver location for the map. Booking screens (FindingVehicle, DriverEnRoute,
/// OnTheWay) are pure consumers of [RideState.ride]'s status - none of them poll or hold their
/// own copy of the ride.
class RideController extends Notifier<RideState> {
  StreamSubscription<Map<String, dynamic>>? _eventsSub;
  StreamSubscription<DriverLocationUpdate>? _locationSub;

  @override
  RideState build() {
    final socket = ref.watch(rideSocketServiceProvider);
    _eventsSub?.cancel();
    _locationSub?.cancel();
    _eventsSub = socket.rideEvents.listen(_onRideEvent);
    _locationSub = socket.driverLocationUpdates.listen(
      (update) => state = state.copyWith(driverLocation: update),
    );
    socket.connect();
    ref.onDispose(() {
      _eventsSub?.cancel();
      _locationSub?.cancel();
    });
    return const RideState();
  }

  RidesRepository get _repository => ref.read(ridesRepositoryProvider);

  void _onRideEvent(Map<String, dynamic> payload) {
    final rideId = payload['rideId'] as String?;
    final current = state.ride;
    // Only react to the rider's own currently-tracked ride - or, with none tracked yet (e.g.
    // app just launched and the socket's connection-time RideSync arrives first), accept
    // whatever RideSync names, so resuming an in-progress ride after a restart/reconnect works
    // without the UI having to ask first.
    if (rideId == null) return;
    if (current != null && current.id != rideId) return;
    unawaited(_refresh(rideId));
  }

  Future<void> _refresh(String rideId) async {
    try {
      final ride = await _repository.getRide(rideId);
      state = state.copyWith(ride: ride, clearError: true);
    } catch (_) {
      // Transient - the next event or an explicit refresh() will retry. Don't blow away
      // whatever ride state is already shown over one failed re-fetch.
    }
  }

  /// Re-fetches the current ride over REST - for pull-to-refresh / resuming after an error, not
  /// part of the normal event-driven flow.
  Future<void> refresh() async {
    final id = state.ride?.id;
    if (id != null) await _refresh(id);
  }

  Future<bool> requestRide({
    required double pickupLatitude,
    required double pickupLongitude,
    String? pickupLocationName,
    required double destinationLatitude,
    required double destinationLongitude,
    String? destinationLocationName,
  }) async {
    state = state.copyWith(isRequesting: true, clearError: true);
    try {
      final ride = await _repository.createRide(
        pickupLatitude: pickupLatitude,
        pickupLongitude: pickupLongitude,
        pickupLocationName: pickupLocationName,
        destinationLatitude: destinationLatitude,
        destinationLongitude: destinationLongitude,
        destinationLocationName: destinationLocationName,
      );
      state = state.copyWith(ride: ride, isRequesting: false);
      return true;
    } on RideException catch (e) {
      if (e.activeRideId != null) {
        // The rider already has a non-terminal ride (rides.service.ts#create's
        // ACTIVE_RIDE_ALREADY_EXISTS) - resume that one instead of surfacing this as an error.
        await _refresh(e.activeRideId!);
        state = state.copyWith(isRequesting: false);
        return true;
      }
      state = state.copyWith(isRequesting: false, errorMessage: e.message);
      return false;
    }
  }

  Future<bool> cancelRide({String? reason}) async {
    final id = state.ride?.id;
    if (id == null) return false;
    try {
      final ride = await _repository.cancelRide(id, reason: reason);
      state = state.copyWith(ride: ride, clearError: true);
      return true;
    } on RideException catch (e) {
      state = state.copyWith(errorMessage: e.message);
      return false;
    }
  }

  void clear() => state = const RideState();
}

final rideControllerProvider = NotifierProvider<RideController, RideState>(RideController.new);
