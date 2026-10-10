import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/config/api_config.dart';
import '../../../core/network/token_storage.dart';

/// Events a DRIVER-role socket actually receives on apps/api's `/ws` gateway - per
/// events/consumers/ride-event-routing.ts's RIDE_EVENT_ROUTING, only 'assignedDriver' and
/// 'offeredDriver' routes ever reach a driver (RideAssigned, RideCancelled, RideDriverNotified),
/// plus location.gateway.ts's own connection-time RideSync. Driver-caused transitions
/// (DriverArrived/RideStarted/RideCompleted) are NOT pushed back to the driver - they're the
/// driver's own REST calls, nothing to notify them of.
///
/// 'RideDriverNotified' carries only `{rideId, driverId}` (dispatch.service.ts#offerToDriver) -
/// no pickup/destination - so it's treated purely as an instant-poll trigger for
/// `GET /dispatch/offers/me`, same "WS hints, REST is authoritative" pattern the rider socket
/// service uses for ride state.
const driverWsEvents = ['RideAssigned', 'RideCancelled', 'RideDriverNotified', 'RideSync'];

/// Inbound event name the driver app pushes a GPS fix on - matches
/// locations/location.gateway.ts's DRIVER_LOCATION_PUSH_EVENT exactly.
const driverLocationPushEvent = 'driver.location';

class DriverSocketService {
  DriverSocketService({TokenStorage? tokenStorage}) : _tokenStorage = tokenStorage ?? TokenStorage();

  final TokenStorage _tokenStorage;
  io.Socket? _socket;

  final _eventsController = StreamController<Map<String, dynamic>>.broadcast();

  /// Emits the raw payload of any event in [driverWsEvents], tagged with `_event`.
  Stream<Map<String, dynamic>> get events => _eventsController.stream;

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

    for (final event in driverWsEvents) {
      socket.on(event, (data) {
        if (data is Map) {
          _eventsController.add({'_event': event, ...Map<String, dynamic>.from(data)});
        }
      });
    }

    _socket = socket;
  }

  /// Pushes a GPS fix - matches DriverLocationPushPayload (location.gateway.ts): latitude/
  /// longitude required, heading/speed/accuracy optional. A no-op if not connected (e.g. the
  /// socket hasn't finished connecting yet, or the driver went offline mid-stream) - the next
  /// position update will simply try again, matching the push pipeline's documented
  /// best-effort nature.
  void pushLocation({
    required double latitude,
    required double longitude,
    double? heading,
    double? speed,
    double? accuracy,
  }) {
    _socket?.emit(driverLocationPushEvent, {
      'latitude': latitude,
      'longitude': longitude,
      'heading': ?heading,
      'speed': ?speed,
      'accuracy': ?accuracy,
    });
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  void dispose() {
    disconnect();
    _eventsController.close();
  }
}
