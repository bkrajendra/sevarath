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
      }, 0);

      expect(loc.name, 'Main Gate');
      expect(loc.category, 'Headquarters');
      expect(loc.type, 'GATE');
    });

    test(
      'title-cases the type as a fallback category when description is null',
      () {
        final loc = campusLocationUiFromJson({
          'id': 'def-456',
          'name': 'EV Charging Point',
          'type': 'EV_STOP',
          'description': null,
        }, 1);

        expect(loc.category, 'Ev Stop');
      },
    );
  });
}
