import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../ride/data/rides_repository.dart';
import '../../ride/models/ride.dart';
import '../data/driver_repository.dart';
import '../data/driver_socket_service.dart';
import '../models/driver_models.dart';

final driverRepositoryProvider = Provider<DriverRepository>((ref) => DriverRepository());
final dispatchRepositoryProvider = Provider<DispatchRepository>((ref) => DispatchRepository());
final ridesRepositoryProvider = Provider<RidesRepository>((ref) => RidesRepository());

final driverSocketServiceProvider = Provider<DriverSocketService>((ref) {
  final service = DriverSocketService();
  ref.onDispose(service.dispose);
  return service;
});

// --- Status (online/offline/on-break) ---

class DriverStatusState {
  const DriverStatusState({
    this.availability = DriverAvailability.offline,
    this.isUpdating = false,
    this.errorMessage,
  });

  final DriverAvailability availability;
  final bool isUpdating;
  final String? errorMessage;

  DriverStatusState copyWith({
    DriverAvailability? availability,
    bool? isUpdating,
    String? errorMessage,
    bool clearError = false,
  }) {
    return DriverStatusState(
      availability: availability ?? this.availability,
      isUpdating: isUpdating ?? this.isUpdating,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

/// Owns the driver's self-reported availability. `busy` is never sent to the server (it's
/// system-derived from ride assignment - drivers.controller.ts only accepts OFFLINE/AVAILABLE/
/// ON_BREAK) - [setDerivedBusy] just keeps the local toggle UI honest while a ride is active,
/// called by [DriverRideController] whenever its active ride appears/disappears.
class DriverStatusController extends Notifier<DriverStatusState> {
  @override
  DriverStatusState build() => const DriverStatusState();

  Future<bool> setAvailability(DriverAvailability availability) async {
    state = state.copyWith(isUpdating: true, clearError: true);
    try {
      await ref.read(driverRepositoryProvider).updateStatus(availability);
      state = state.copyWith(availability: availability, isUpdating: false);
      return true;
    } on DriverException catch (e) {
      state = state.copyWith(isUpdating: false, errorMessage: e.message);
      return false;
    }
  }

  void setDerivedBusy(bool busy) {
    if (busy) {
      state = state.copyWith(availability: DriverAvailability.busy);
    } else if (state.availability == DriverAvailability.busy) {
      // Only AVAILABLE drivers are ever matched (driver-matcher.service.ts), so that's the
      // correct state to fall back to once the ride ends - not OFFLINE.
      state = state.copyWith(availability: DriverAvailability.available);
    }
  }
}

final driverStatusControllerProvider = NotifierProvider<DriverStatusController, DriverStatusState>(
  DriverStatusController.new,
);

// --- Active ride ---

class DriverRideState {
  const DriverRideState({this.ride, this.isActing = false, this.errorMessage});

  final Ride? ride;
  final bool isActing;
  final String? errorMessage;

  DriverRideState copyWith({
    Ride? ride,
    bool clearRide = false,
    bool? isActing,
    String? errorMessage,
    bool clearError = false,
  }) {
    return DriverRideState(
      ride: clearRide ? null : (ride ?? this.ride),
      isActing: isActing ?? this.isActing,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

/// Owns the driver's current active ride (once accepted) and its arrived/start/complete
/// actions. Kept in sync via the driver socket's RideAssigned/RideCancelled/RideSync events -
/// same "re-fetch over REST on any relevant event" pattern as the rider's RideController.
/// DriverArrived/RideStarted/RideCompleted are never pushed back to the driver (they're the
/// driver's own REST calls - see driver_socket_service.dart), so [markArrived]/[startRide]/
/// [completeRide] update local state directly from their own response instead of waiting for
/// an event that will never arrive.
class DriverRideController extends Notifier<DriverRideState> {
  StreamSubscription<Map<String, dynamic>>? _eventsSub;

  @override
  DriverRideState build() {
    final socket = ref.watch(driverSocketServiceProvider);
    _eventsSub?.cancel();
    _eventsSub = socket.events.listen(_onEvent);
    socket.connect();
    ref.onDispose(() => _eventsSub?.cancel());
    return const DriverRideState();
  }

  void _onEvent(Map<String, dynamic> payload) {
    if (payload['_event'] == 'RideDriverNotified') return; // DriverOfferController's concern
    final rideId = payload['rideId'] as String?;
    if (rideId == null) return;
    final current = state.ride;
    if (current != null && current.id != rideId) return;
    unawaited(_refresh(rideId));
  }

  Future<void> _refresh(String rideId) async {
    try {
      final ride = await ref.read(ridesRepositoryProvider).getRide(rideId);
      _applyRide(ride);
    } catch (_) {
      // Transient - the next event or an explicit refresh retries.
    }
  }

  void _applyRide(Ride ride) {
    if (ride.isTerminal) {
      _setRide(null);
    } else {
      _setRide(ride);
    }
  }

  void _setRide(Ride? ride) {
    state = state.copyWith(ride: ride, clearRide: ride == null);
    ref.read(driverStatusControllerProvider.notifier).setDerivedBusy(ride != null);
  }

  /// Called by DriverOfferController right after a successful accept() - the accept response
  /// already is the full ride, no need for a redundant GET /rides/:id.
  void setActiveRide(Ride ride) => _applyRide(ride);

  Future<bool> markArrived() => _act((repo, id) => repo.markArrived(id));
  Future<bool> startRide() => _act((repo, id) => repo.startRide(id));
  Future<bool> completeRide() => _act((repo, id) => repo.completeRide(id));

  Future<bool> _act(Future<Ride> Function(RidesRepository, String) action) async {
    final id = state.ride?.id;
    if (id == null) return false;
    state = state.copyWith(isActing: true, clearError: true);
    try {
      final ride = await action(ref.read(ridesRepositoryProvider), id);
      _applyRide(ride);
      state = state.copyWith(isActing: false);
      return true;
    } on RideException catch (e) {
      state = state.copyWith(isActing: false, errorMessage: e.message);
      return false;
    }
  }
}

final driverRideControllerProvider = NotifierProvider<DriverRideController, DriverRideState>(
  DriverRideController.new,
);

// --- Pending offer (poll + WS-triggered) ---

class DriverOfferState {
  const DriverOfferState({this.offer, this.isActing = false, this.errorMessage});

  final PendingOffer? offer;
  final bool isActing;
  final String? errorMessage;

  DriverOfferState copyWith({
    PendingOffer? offer,
    bool clearOffer = false,
    bool? isActing,
    String? errorMessage,
    bool clearError = false,
  }) {
    return DriverOfferState(
      offer: clearOffer ? null : (offer ?? this.offer),
      isActing: isActing ?? this.isActing,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

const _pollInterval = Duration(seconds: 3);

/// Polls GET /dispatch/offers/me while the driver is AVAILABLE with no active ride - the
/// authoritative source, since there is no WS push carrying full offer details (only a bare
/// RideDriverNotified{rideId,driverId} hint - see driver_socket_service.dart - used here only
/// to trigger an immediate poll rather than waiting for the next tick).
class DriverOfferController extends Notifier<DriverOfferState> {
  Timer? _pollTimer;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  @override
  DriverOfferState build() {
    final socket = ref.watch(driverSocketServiceProvider);
    _wsSub?.cancel();
    _wsSub = socket.events.listen((payload) {
      if (payload['_event'] == 'RideDriverNotified') {
        unawaited(_poll());
      }
    });
    ref.listen(driverStatusControllerProvider, (previous, next) => _syncPolling());
    ref.listen(driverRideControllerProvider, (previous, next) => _syncPolling());
    ref.onDispose(() {
      _pollTimer?.cancel();
      _wsSub?.cancel();
    });
    _syncPolling();
    return const DriverOfferState();
  }

  bool get _eligible =>
      ref.read(driverStatusControllerProvider).availability == DriverAvailability.available &&
      ref.read(driverRideControllerProvider).ride == null;

  void _syncPolling() {
    if (_eligible && _pollTimer == null) {
      _pollTimer = Timer.periodic(_pollInterval, (_) => unawaited(_poll()));
      unawaited(_poll());
    } else if (!_eligible && _pollTimer != null) {
      _pollTimer?.cancel();
      _pollTimer = null;
      if (state.offer != null) state = state.copyWith(clearOffer: true);
    }
  }

  Future<void> _poll() async {
    try {
      final offer = await ref.read(dispatchRepositoryProvider).getPendingOffer();
      state = state.copyWith(offer: offer, clearOffer: offer == null);
    } catch (_) {
      // Transient - next tick retries.
    }
  }

  Future<bool> accept() async {
    final offer = state.offer;
    if (offer == null) return false;
    state = state.copyWith(isActing: true, clearError: true);
    try {
      final ride = await ref.read(ridesRepositoryProvider).acceptRide(offer.rideId);
      ref.read(driverRideControllerProvider.notifier).setActiveRide(ride);
      state = const DriverOfferState();
      return true;
    } on RideException catch (e) {
      state = state.copyWith(isActing: false, errorMessage: e.message);
      return false;
    }
  }

  Future<bool> reject() async {
    final offer = state.offer;
    if (offer == null) return false;
    state = state.copyWith(isActing: true, clearError: true);
    try {
      await ref.read(ridesRepositoryProvider).rejectRide(offer.rideId);
      state = const DriverOfferState();
      return true;
    } on RideException catch (e) {
      state = state.copyWith(isActing: false, errorMessage: e.message);
      return false;
    }
  }
}

final driverOfferControllerProvider = NotifierProvider<DriverOfferController, DriverOfferState>(
  DriverOfferController.new,
);

// --- Live location push ---

/// Streams the device's GPS position and pushes it over the driver socket whenever the driver
/// is AVAILABLE or BUSY (an active ride) - matches specification.md §6's "push while
/// online/on a ride" intent. Not a Notifier - nothing in the UI reads this directly, it's a
/// background service woken up once by DriverHomeScreen reading [driverLocationPusherProvider].
class DriverLocationPusher {
  DriverLocationPusher(this._ref) {
    _ref.listen(
      driverStatusControllerProvider.select((s) => s.availability),
      (previous, next) => _sync(next),
      fireImmediately: true,
    );
  }

  final Ref _ref;
  StreamSubscription<Position>? _positionSub;

  void _sync(DriverAvailability availability) {
    final shouldStream =
        availability == DriverAvailability.available || availability == DriverAvailability.busy;
    if (shouldStream && _positionSub == null) {
      unawaited(_start());
    } else if (!shouldStream && _positionSub != null) {
      _positionSub?.cancel();
      _positionSub = null;
    }
  }

  Future<void> _start() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return;
    }

    _positionSub =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10),
        ).listen((position) {
          _ref.read(driverSocketServiceProvider).pushLocation(
            latitude: position.latitude,
            longitude: position.longitude,
            heading: position.heading,
            speed: position.speed,
            accuracy: position.accuracy,
          );
        });
  }

  void dispose() {
    _positionSub?.cancel();
  }
}

final driverLocationPusherProvider = Provider<DriverLocationPusher>((ref) {
  final pusher = DriverLocationPusher(ref);
  ref.onDispose(pusher.dispose);
  return pusher;
});
