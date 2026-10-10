import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/destination/data/campus_locations_repository.dart';

void main() {
  group('campusLocationUiFromJson', () {
    test('uses description as the category when present', () {
      final loc = campusLocationUiFromJson({
        'id': 'abc-123',
        'name': 'Main Gate',
        'type': 'GATE',
        'description': 'Headquarters',
        'latitude': 24.5313075,
        'longitude': 72.7947805,
      }, 0);

      expect(loc.name, 'Main Gate');
      expect(loc.category, 'Headquarters');
      expect(loc.type, 'GATE');
      expect(loc.latitude, 24.5313075);
      expect(loc.longitude, 72.7947805);
    });

    test(
      'title-cases the type as a fallback category when description is null',
      () {
        final loc = campusLocationUiFromJson({
          'id': 'def-456',
          'name': 'EV Charging Point',
          'type': 'EV_STOP',
          'description': null,
          'latitude': 24.53,
          'longitude': 72.79,
        }, 1);

        expect(loc.category, 'Ev Stop');
      },
    );
  });
}
