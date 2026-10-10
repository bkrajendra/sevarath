import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:sevarath_mobile/features/driver/data/maps_repository.dart';

void main() {
  group('decodeValhallaPolyline', () {
    test('decodes a precision-1e6 encoded polyline (not the common 1e5)', () {
      // Independently generated with the standard polyline-encode algorithm at precision 1e6
      // from these exact 3 points - a verified fixture, not hand-written.
      final points = decodeValhallaPolyline('gugxm@wh`ziCoKgYg^wj@');

      expect(points.length, 3);
      expect(points[0].latitude, closeTo(24.531300, 0.000001));
      expect(points[0].longitude, closeTo(72.794780, 0.000001));
      expect(points[1].latitude, closeTo(24.531500, 0.000001));
      expect(points[1].longitude, closeTo(72.795200, 0.000001));
      expect(points[2].latitude, closeTo(24.532000, 0.000001));
      expect(points[2].longitude, closeTo(72.795900, 0.000001));
    });

    test('an empty string decodes to no points', () {
      expect(decodeValhallaPolyline(''), isEmpty);
    });
  });

  group('haversineMeters', () {
    test('the same point is zero meters away', () {
      const p = LatLng(24.5313, 72.7948);
      expect(haversineMeters(p, p), 0);
    });

    test('roughly matches a known short campus-scale distance', () {
      // ~0.001 deg of latitude is ~111m.
      const a = LatLng(24.5313, 72.7948);
      const b = LatLng(24.5323, 72.7948);
      expect(haversineMeters(a, b), closeTo(111, 2));
    });
  });

  group('distanceToSegmentMeters', () {
    test('a point exactly on the segment is ~0m away', () {
      const a = LatLng(24.5300, 72.7900);
      const b = LatLng(24.5310, 72.7900);
      const midpoint = LatLng(24.5305, 72.7900);
      expect(distanceToSegmentMeters(midpoint, a, b), closeTo(0, 1));
    });

    test('a point off to the side is measured perpendicular to the segment, not to an endpoint', () {
      const a = LatLng(24.5300, 72.7900);
      const b = LatLng(24.5310, 72.7900);
      // Due east of the segment's midpoint, roughly 0.0001 deg of longitude away (~10m at this
      // latitude) - closer to the perpendicular projection than to either endpoint.
      const offToTheSide = LatLng(24.5305, 72.7901);
      final distance = distanceToSegmentMeters(offToTheSide, a, b);
      final distanceToNearestEndpoint = [
        haversineMeters(offToTheSide, a),
        haversineMeters(offToTheSide, b),
      ].reduce((x, y) => x < y ? x : y);
      expect(distance, lessThan(distanceToNearestEndpoint));
    });

    test('beyond either end of the segment, distance is to the nearest endpoint', () {
      const a = LatLng(24.5300, 72.7900);
      const b = LatLng(24.5310, 72.7900);
      const pastA = LatLng(24.5290, 72.7900);
      expect(distanceToSegmentMeters(pastA, a, b), closeTo(haversineMeters(pastA, a), 1));
    });
  });
}
