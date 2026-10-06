import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';

import 'package:sevarath_mobile/app.dart';
import 'package:sevarath_mobile/core/config/flavor.dart';

/// Stands in for the platform channel `flutter_secure_storage` normally
/// talks to - without this, AuthController's startup session check throws
/// MissingPluginException and auth state never leaves AuthStatus.unknown,
/// so the router's redirect gets stuck re-targeting /splash forever.
class _FakeSecureStorage extends FlutterSecureStoragePlatform {
  final Map<String, String> _data = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    required Map<String, String> options,
  }) async {
    if (value == null) {
      _data.remove(key);
    } else {
      _data[key] = value;
    }
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async => _data[key];

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    _data.remove(key);
  }

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => _data.containsKey(key);

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => Map<String, String>.from(_data);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    _data.clear();
  }
}

void main() {
  setUpAll(() {
    FlavorConfig.initialize(flavor: Flavor.user, appName: 'Sevarath');
  });

  setUp(() {
    FlutterSecureStoragePlatform.instance = _FakeSecureStorage();
  });

  testWidgets('splash screen shows the Sevarath wordmark', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const SevarathApp(title: 'Sevarath'));
    await tester.pump();

    expect(find.text('Sevarath'), findsOneWidget);
    expect(find.text('Your Companion for Every Journey'), findsOneWidget);

    // Flush the splash screen's auto-navigate timer so it isn't still
    // pending when the test ends (flutter_test asserts no pending timers).
    await tester.pump(const Duration(milliseconds: 2100));
    await tester.pumpAndSettle();
  });

  testWidgets(
    'navigates from splash to login after the delay when signed out',
    (WidgetTester tester) async {
      await tester.pumpWidget(const SevarathApp(title: 'Sevarath'));
      await tester.pump(const Duration(milliseconds: 2100));
      await tester.pumpAndSettle();

      // No session has been stored, so the router's auth-gating redirect sends
      // a signed-out user to /login rather than /home.
      expect(find.text('Welcome back'), findsOneWidget);
    },
  );
}
