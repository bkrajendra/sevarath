import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../models/driver_models.dart';

class DriverException implements Exception {
  DriverException(this.message);
  final String message;

  @override
  String toString() => message;
}

String _messageForDriverError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] != null) {
    final message = data['message'];
    if (message is List) return message.join(', ');
    return message.toString();
  }
  return 'Something went wrong. Please try again.';
}

/// apps/api/src/drivers/drivers.controller.ts - the driver's own self-service actions.
class DriverRepository {
  DriverRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  /// POST /drivers/status - only OFFLINE/AVAILABLE/ON_BREAK are client-settable
  /// (UpdateAvailabilityDto's SELF_SETTABLE list); BUSY is system-set on ride assignment.
  Future<void> updateStatus(DriverAvailability availability) async {
    try {
      await _apiClient.dio.post(
        '/drivers/status',
        data: {'availability': driverAvailabilityToWire(availability)},
      );
    } on DioException catch (e) {
      throw DriverException(_messageForDriverError(e));
    }
  }
}

/// apps/api/src/dispatch/dispatch.controller.ts's DispatchOffersController - the driver's
/// poll-for-a-pending-offer endpoint. This is the authoritative source; the WS gateway's
/// 'RideDriverNotified' push (see driver_socket_service.dart) is only an instant-poll trigger
/// on top of it, matching this codebase's "WS is best-effort, REST is the real source" pattern.
class DispatchRepository {
  DispatchRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<PendingOffer?> getPendingOffer() async {
    try {
      final response = await _apiClient.dio.get('/dispatch/offers/me');
      final data = response.data;
      if (data == null) return null;
      return PendingOffer.fromJson(data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw DriverException(_messageForDriverError(e));
    }
  }
}
