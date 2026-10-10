import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/config/api_config.dart';
import '../../../core/network/token_storage.dart';

/// Event names this app listens for on the `/ws` gateway - mirrors
/// apps/api/src/events/consumers/ride-event-routing.ts's RIDE_EVENT_ROUTING keys (the ones
/// routed to 'rider') plus location.gateway.ts's own RIDE_SYNC_EVENT/DRIVER_LOCATION_UPDATED_EVENT.
/// Every one of these (except driverLocationUpdated) carries at least {rideId, status} - this
/// app re-fetches the full ride over REST rather than trusting the rest of the payload, per the
/// backend's own documented design ("the client re-fetches the authoritative booking over REST
/// if it needs more" - domain-event-realtime.consumer.ts).
const rideWsEvents = [
  'RideAssigned',
  'RideCancelled',
  'RideNoDriverAvailable',
  'DriverArrived',
  'RideStarted',
  'RideCompleted',
  'RideSync',
];
const driverLocationUpdatedEvent = 'DriverLocationUpdated';

class DriverLocationUpdate {
  const DriverLocationUpdate({
    required this.rideId,
    required this.latitude,
    required this.longitude,
    this.heading,
    this.speed,
  });

  final String rideId;
  final double latitude;
  final double longitude;
  final double? heading;
  final double? speed;

  factory DriverLocationUpdate.fromJson(Map<String, dynamic> json) {
    return DriverLocationUpdate(
      rideId: json['rideId'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      heading: (json['heading'] as num?)?.toDouble(),
      speed: (json['speed'] as num?)?.toDouble(),
    );
  }
}

/// Thin wrapper around the socket.io client for apps/api's `/ws` gateway
/// (locations/location.gateway.ts). Auth matches ws-jwt.guard.ts exactly: the access token is
/// sent as `handshake.auth.token`, not a header - socket.io's handshake happens before any
/// per-message interceptor (like ApiClient's Dio one) could run, so this has its own token read.
///
/// Reconnection is handled by socket.io's own client (enabled by default) - on every
/// (re)connect, the gateway itself pushes a `RideSync` snapshot (location.gateway.ts), which
/// `RideController` uses to resume whatever ride is actually current server-side rather than
/// this class needing its own resume logic.
class RideSocketService {
  RideSocketService({TokenStorage? tokenStorage}) : _tokenStorage = tokenStorage ?? TokenStorage();

  final TokenStorage _tokenStorage;
  io.Socket? _socket;

  final _rideEventsController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocationController = StreamController<DriverLocationUpdate>.broadcast();

  /// Emits the raw payload of any event in [rideWsEvents], tagged with `_event` for the
  /// listener to tell them apart (all of them are handled identically by RideController: re-fetch).
  Stream<Map<String, dynamic>> get rideEvents => _rideEventsController.stream;
  Stream<DriverLocationUpdate> get driverLocationUpdates => _driverLocationController.stream;

  Future<void> connect() async {
    if (_socket != null) return;
    final token = await _tokenStorage.readAccessToken();
    if (token == null) return;

    final socket = io.io(
      ApiConfig.wsUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .build(),
    );

    for (final event in rideWsEvents) {
      socket.on(event, (data) {
        if (data is Map) {
          _rideEventsController.add({'_event': event, ...Map<String, dynamic>.from(data)});
        }
      });
    }
    socket.on(driverLocationUpdatedEvent, (data) {
      if (data is Map) {
        _driverLocationController.add(DriverLocationUpdate.fromJson(Map<String, dynamic>.from(data)));
      }
    });

    _socket = socket;
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  void dispose() {
    disconnect();
    _rideEventsController.close();
    _driverLocationController.close();
  }
}
