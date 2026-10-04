import 'package:flutter/material.dart';
import 'app.dart';
import 'core/config/flavor.dart';

void main() {
  FlavorConfig.initialize(flavor: Flavor.user, appName: 'Sevarath');
  runApp(const SevarathApp(title: 'Sevarath'));
}
