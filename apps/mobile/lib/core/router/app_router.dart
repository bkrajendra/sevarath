import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_screen.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/register_screen.dart';
import '../../features/splash/splash_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/destination/select_destination_screen.dart';
import '../../features/ride/confirm_ride_screen.dart';
import '../../features/ride/finding_vehicle_screen.dart';
import '../../features/ride/driver_en_route_screen.dart';
import '../../features/ride/on_the_way_screen.dart';
import '../../features/ride/ride_details_screen.dart';
import '../../features/ride/rate_ride_screen.dart';
import '../../features/ride/rides_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../shared/widgets/app_shell.dart';
import 'auth_router_notifier.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _shellNavigatorKey =
    GlobalKey<NavigatorState>();

final GoRouter appRouter = GoRouter(
  navigatorKey: rootNavigatorKey,
  initialLocation: '/splash',
  refreshListenable: authRouterNotifier,
  redirect: (context, state) {
    final authState = ProviderScope.containerOf(context)
        .read(authControllerProvider);
    final isAuthed = authState.status == AuthStatus.authenticated;
    final isLoading = authState.status == AuthStatus.unknown;
    final goingToAuthScreen =
        state.matchedLocation == '/login' ||
        state.matchedLocation == '/register';
    final goingToSplash = state.matchedLocation == '/splash';

    if (isLoading) {
      return goingToSplash ? null : '/splash';
    }
    if (!isAuthed && !goingToAuthScreen) {
      return '/login';
    }
    if (isAuthed && (goingToAuthScreen || goingToSplash)) {
      return '/home';
    }
    return null;
  },
  routes: [
    GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),
    GoRoute(
      path: '/login',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/register',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const RegisterScreen(),
    ),

    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) =>
          AppShell(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          navigatorKey: _shellNavigatorKey,
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/rides',
              builder: (context, state) => const RidesScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfileScreen(),
            ),
          ],
        ),
      ],
    ),

    GoRoute(
      path: '/select-destination',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const SelectDestinationScreen(),
    ),
    GoRoute(
      path: '/confirm-ride',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const ConfirmRideScreen(),
    ),
    GoRoute(
      path: '/finding-vehicle',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const FindingVehicleScreen(),
    ),
    GoRoute(
      path: '/driver-en-route',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const DriverEnRouteScreen(),
    ),
    GoRoute(
      path: '/on-the-way',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const OnTheWayScreen(),
    ),
    GoRoute(
      path: '/ride-details',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const RideDetailsScreen(),
    ),
    GoRoute(
      path: '/rate-ride',
      parentNavigatorKey: rootNavigatorKey,
      builder: (context, state) => const RateRideScreen(),
    ),
  ],
);
