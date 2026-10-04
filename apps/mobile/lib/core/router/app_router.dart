import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
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

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _shellNavigatorKey = GlobalKey<NavigatorState>();

final GoRouter appRouter = GoRouter(
  navigatorKey: rootNavigatorKey,
  initialLocation: '/splash',
  routes: [
    GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),

    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => AppShell(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          navigatorKey: _shellNavigatorKey,
          routes: [GoRoute(path: '/home', builder: (context, state) => const HomeScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: '/rides', builder: (context, state) => const RidesScreen())],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen())],
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
