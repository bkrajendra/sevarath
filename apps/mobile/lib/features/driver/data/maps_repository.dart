import 'dart:math';

import 'package:dio/dio.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../../core/network/api_client.dart';
import '../models/route_models.dart';

class MapsException implements Exception {
  MapsException(this.message);
  final String message;

  @override
  String toString() => message;
}

String _messageForMapsError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] != null) {
    final message = data['message'];
    if (message is List) return message.join(', ');
    return message.toString();
  }
  return 'Could not load the route. Please try again.';
}

/// Decodes a Valhalla-encoded polyline - the standard Google polyline algorithm, but at
/// Valhalla's default precision (1e6), not the common 1e5 most polyline packages assume.
/// apps/api/src/maps/dto/route-response.dto.ts's `shape` field documents this exactly.
List<LatLng> decodeValhallaPolyline(String encoded) {
  final points = <LatLng>[];
  var index = 0;
  final length = encoded.length;
  var lat = 0;
  var lng = 0;
  const factor = 1e6;

  while (index < length) {
    var shift = 0;
    var result = 0;
    int b;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    points.add(LatLng(lat / factor, lng / factor));
  }
  return points;
}

/// apps/api/src/maps/maps.controller.ts - GET /maps/route, backed by Valhalla
/// (RoutingProvider interface) - architecture.md §8.
class MapsRepository {
  MapsRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<RouteInfo> getRoute({
    required double originLatitude,
    required double originLongitude,
    required double destinationLatitude,
    required double destinationLongitude,
  }) async {
    try {
      final response = await _apiClient.dio.get(
        '/maps/route',
        queryParameters: {
          'originLat': originLatitude,
          'originLng': originLongitude,
          'destinationLat': destinationLatitude,
          'destinationLng': destinationLongitude,
        },
      );
      final data = response.data as Map<String, dynamic>;
      final maneuvers = (data['maneuvers'] as List<dynamic>)
          .map((json) => RouteManeuver.fromJson(json as Map<String, dynamic>))
          .toList();
      return RouteInfo(
        polyline: decodeValhallaPolyline(data['shape'] as String),
        lengthKm: (data['length'] as num).toDouble(),
        timeSeconds: (data['time'] as num).toDouble(),
        maneuvers: maneuvers,
      );
    } on DioException catch (e) {
      throw MapsException(_messageForMapsError(e));
    }
  }
}

/// Great-circle distance in meters - Haversine, matches the precision the app needs for
/// off-route detection/maneuver-progress (not a geodesic library, this is a small campus).
double haversineMeters(LatLng a, LatLng b) {
  const earthRadiusMeters = 6371000.0;
  final lat1 = a.latitude * pi / 180;
  final lat2 = b.latitude * pi / 180;
  final dLat = (b.latitude - a.latitude) * pi / 180;
  final dLng = (b.longitude - a.longitude) * pi / 180;
  final h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2);
  return earthRadiusMeters * 2 * atan2(sqrt(h), sqrt(1 - h));
}

/// Perpendicular distance in meters from [point] to the line segment [a]-[b] - used to find how
/// far the driver's live GPS fix is off the route polyline.
double distanceToSegmentMeters(LatLng point, LatLng a, LatLng b) {
  // Treat lat/lng as a flat local plane (fine at campus scale) scaled by a rough
  // meters-per-degree factor so the projection math is simple Euclidean geometry.
  const metersPerDegreeLat = 111320.0;
  final metersPerDegreeLng = 111320.0 * cos(point.latitude * pi / 180);

  final px = point.longitude * metersPerDegreeLng;
  final py = point.latitude * metersPerDegreeLat;
  final ax = a.longitude * metersPerDegreeLng;
  final ay = a.latitude * metersPerDegreeLat;
  final bx = b.longitude * metersPerDegreeLng;
  final by = b.latitude * metersPerDegreeLat;

  final dx = bx - ax;
  final dy = by - ay;
  final lengthSquared = dx * dx + dy * dy;
  if (lengthSquared == 0) {
    return haversineMeters(point, a);
  }
  var t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t.clamp(0.0, 1.0);
  final projX = ax + t * dx;
  final projY = ay + t * dy;
  final ddx = px - projX;
  final ddy = py - projY;
  return sqrt(ddx * ddx + ddy * ddy);
}
