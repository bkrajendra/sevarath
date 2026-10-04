import 'package:flutter/material.dart';
import 'app.dart';
import 'core/config/flavor.dart';

// Driver-specific screens (go online/offline, accept/reject requests - the
// backend already supports these via POST /api/v1/drivers/status, see
// apps/api/src/drivers/) aren't built yet; this flavor currently boots the
// same shell as a placeholder. Branch FlavorConfig.isDriver where the two
// experiences diverge once those screens exist.
void main() {
  FlavorConfig.initialize(flavor: Flavor.driver, appName: 'Sevarath Driver');
  runApp(const SevarathApp(title: 'Sevarath Driver'));
}
