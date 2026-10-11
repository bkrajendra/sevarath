import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'app.dart';
import 'core/config/flavor.dart';
import 'features/notifications/push_notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlavorConfig.initialize(flavor: Flavor.driver, appName: 'Sevarath Driver');
  // Android only - picks up google-services.json's 'com.rajendrakhope.sevarath.driver' client
  // entry (Phase 10.2, docs/plan.md §5). See main_user.dart's own comment for the full reasoning.
  await Firebase.initializeApp();
  unawaited(pushNotificationService.initialize());
  runApp(const SevarathApp(title: 'Sevarath Driver'));
}
