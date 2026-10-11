import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'app.dart';
import 'core/config/flavor.dart';
import 'features/notifications/push_notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlavorConfig.initialize(flavor: Flavor.user, appName: 'Sevarath');
  // Android only (no FirebaseOptions passed) - picks up android/app/google-services.json's
  // 'com.rajendrakhope.sevarath' client entry via the google-services Gradle plugin's native
  // default app config (Phase 10.2/10.5, docs/plan.md §5). No iOS config exists yet (Phase 3's
  // known gap - no iOS flavor split), so this would need FirebaseOptions once that exists.
  await Firebase.initializeApp();
  unawaited(pushNotificationService.initialize());
  runApp(const SevarathApp(title: 'Sevarath'));
}
