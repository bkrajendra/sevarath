import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_screen.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/splash/splash_screen.dart';
import '../../features/driver/driver_home_screen.dart';
import '../../features/driver/driver_profile_screen.dart';
import '../../features/driver/incoming_offer_screen.dart';
import '../../shared/widgets/driver_app_shell.dart';
import 'auth_router_notifier.dart';

/// Separate GoRouter for the driver build flavor (FlavorConfig.isDriver) - see app.dart. Route
/// paths that exist in both routers (`/splash`, `/home`, `/profile`) intentionally reuse the
/// same path strings so shared screens like SplashScreen (which hardcodes `context.go('/home')`)
/// don't need to be flavor-aware; they just resolve against whichever router is actually
/// mounted. There is deliberately no `/register` route - drivers are provisioned by an Admin,
/// not self-registered (see login_screen.dart's FlavorConfig.isDriver check).
final GlobalKey<NavigatorState> driverRootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _driverShellNavigatorKey = GlobalKey<NavigatorState>();

final GoRouter driverRouter = GoRouter(
  navigatorKey: driverRootNavigatorKey,
  initialLocation: '/splash',
  refreshListenable: authRouterNotifier,
  redirect: (context, state) {
    final authState = ProviderScope.containerOf(context).read(authControllerProvider);
    final isAuthed = authState.status == AuthStatus.authenticated;
    final isLoading = authState.status == AuthStatus.unknown;
    final goingToAuthScreen = state.matchedLocation == '/login';
    final goingToSplash = state.matchedLocation == '/splash';

    if (isLoading) {
      return goingToSplash ? null : '/splash';
    }
    if (goingToSplash) {
      return null;
    }
    if (!isAuthed && !goingToAuthScreen) {
      return '/login';
    }
    if (isAuthed && goingToAuthScreen) {
      return '/home';
    }
    return null;
  },
  routes: [
    GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),
    GoRoute(
      path: '/login',
      parentNavigatorKey: driverRootNavigatorKey,
      builder: (context, state) => const LoginScreen(),
    ),

    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => DriverAppShell(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          navigatorKey: _driverShellNavigatorKey,
          routes: [
            GoRoute(path: '/home', builder: (context, state) => const DriverHomeScreen()),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(path: '/profile', builder: (context, state) => const DriverProfileScreen()),
          ],
        ),
      ],
    ),

    GoRoute(
      path: '/driver/incoming-offer',
      parentNavigatorKey: driverRootNavigatorKey,
      builder: (context, state) => const IncomingOfferScreen(),
    ),
  ],
);
