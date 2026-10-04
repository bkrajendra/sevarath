import 'package:flutter_test/flutter_test.dart';

import 'package:sevarath_mobile/app.dart';
import 'package:sevarath_mobile/core/config/flavor.dart';

void main() {
  setUpAll(() {
    FlavorConfig.initialize(flavor: Flavor.user, appName: 'Sevarath');
  });

  testWidgets('splash screen shows the Sevarath wordmark', (WidgetTester tester) async {
    await tester.pumpWidget(const SevarathApp(title: 'Sevarath'));
    await tester.pump();

    expect(find.text('Sevarath'), findsOneWidget);
    expect(find.text('Your Companion for Every Journey'), findsOneWidget);

    // Flush the splash screen's auto-navigate timer so it isn't still
    // pending when the test ends (flutter_test asserts no pending timers).
    await tester.pump(const Duration(milliseconds: 2100));
    await tester.pumpAndSettle();
  });

  testWidgets('navigates from splash to home after the delay', (WidgetTester tester) async {
    await tester.pumpWidget(const SevarathApp(title: 'Sevarath'));
    await tester.pump(const Duration(milliseconds: 2100));
    await tester.pumpAndSettle();

    expect(find.text('Good Morning'), findsOneWidget);
    expect(find.text('Where would you like to go?'), findsOneWidget);
  });
}
