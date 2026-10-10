import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../models/ride.dart';

class RideException implements Exception {
  RideException(this.message, {this.activeRideId});
  final String message;

  /// Set when the backend rejected a create call with 409 ACTIVE_RIDE_ALREADY_EXISTS
  /// (rides.service.ts#create) - callers should resume this ride rather than show an error.
  final String? activeRideId;

  @override
  String toString() => message;
}

String _messageForRideError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] != null) {
    final message = data['message'];
    if (message is List) return message.join(', ');
    return message.toString();
  }
  return 'Something went wrong. Please try again.';
}

class RidesRepository {
  RidesRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<Ride> createRide({
    required double pickupLatitude,
    required double pickupLongitude,
    String? pickupLocationName,
    required double destinationLatitude,
    required double destinationLongitude,
    String? destinationLocationName,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        '/rides',
        data: {
          'pickupLatitude': pickupLatitude,
          'pickupLongitude': pickupLongitude,
          'pickupLocationName': ?pickupLocationName,
          'destinationLatitude': destinationLatitude,
          'destinationLongitude': destinationLongitude,
          'destinationLocationName': ?destinationLocationName,
        },
      );
      return Ride.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final data = e.response?.data;
      if (e.response?.statusCode == 409 && data is Map && data['code'] == 'ACTIVE_RIDE_ALREADY_EXISTS') {
        throw RideException(_messageForRideError(e), activeRideId: data['rideId'] as String?);
      }
      throw RideException(_messageForRideError(e));
    }
  }

  Future<Ride> getRide(String id) async {
    try {
      final response = await _apiClient.dio.get('/rides/$id');
      return Ride.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw RideException(_messageForRideError(e));
    }
  }

  Future<List<Ride>> getHistory() async {
    try {
      final response = await _apiClient.dio.get('/rides/history');
      final data = response.data as List<dynamic>;
      return data.map((json) => Ride.fromJson(json as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw RideException(_messageForRideError(e));
    }
  }

  Future<Ride> cancelRide(String id, {String? reason}) async {
    try {
      final response = await _apiClient.dio.post(
        '/rides/$id/cancel',
        data: {'reason': ?reason},
      );
      return Ride.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw RideException(_messageForRideError(e));
    }
  }
}
