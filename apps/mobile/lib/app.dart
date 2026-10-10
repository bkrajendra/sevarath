import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/flavor.dart';
import 'core/router/app_router.dart';
import 'core/router/driver_router.dart';
import 'core/theme/app_theme.dart';

class SevarathApp extends StatelessWidget {
  const SevarathApp({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      child: MaterialApp.router(
        title: title,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        routerConfig: FlavorConfig.isDriver ? driverRouter : appRouter,
      ),
    );
  }
}
