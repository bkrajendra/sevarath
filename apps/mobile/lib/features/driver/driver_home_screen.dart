import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';
import '../ride/models/ride.dart';
import '../../shared/widgets/campus_map_preview.dart';
import 'models/driver_models.dart';
import 'providers/driver_providers.dart';
import 'providers/navigation_provider.dart';

/// Whichever point the driver is currently headed toward (pickup while en route to pickup, the
/// ride's destination once started) - null while stationary (DRIVER_ARRIVED, or no active ride),
/// matching when turn-by-turn guidance should actually run (plan.md Phase 6).
LatLng? _navigationTargetFor(Ride ride) {
  switch (ride.status) {
    case RideStatus.driverAssigned:
    case RideStatus.driverEnRouteToPickup:
      return LatLng(ride.pickupLatitude, ride.pickupLongitude);
    case RideStatus.rideStarted:
    case RideStatus.driverEnRouteToDestination:
      return LatLng(ride.destinationLatitude, ride.destinationLongitude);
    default:
      return null;
  }
}

class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  @override
  void initState() {
    super.initState();
    // Handles the "app (re)started mid-ride" case - RideSync may already have populated an
    // active ride by the time this screen first mounts, before any ref.listen change fires.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ride = ref.read(driverRideControllerProvider).ride;
      _syncNavigation(ride);
    });
  }

  void _syncNavigation(Ride? ride) {
    final notifier = ref.read(navigationControllerProvider.notifier);
    final target = ride == null ? null : _navigationTargetFor(ride);
    if (target != null) {
      notifier.start(target);
    } else {
      notifier.stop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).user;

    // Backend enforces every driver-only endpoint with @Roles('DRIVER') anyway, but a clear
    // in-app message beats a confusing wall of 403s for a USER-role account that ends up in
    // this build flavor by mistake.
    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (user.role != 'DRIVER') {
      return _NotADriverAccount(onSignOut: () async {
        await ref.read(authControllerProvider.notifier).logout();
        if (context.mounted) context.go('/login');
      });
    }

    // Wakes the background GPS-push service for the lifetime of this screen - see
    // driver_providers.dart's own doc comment on why this isn't a Notifier the UI reads from.
    ref.watch(driverLocationPusherProvider);

    final rideState = ref.watch(driverRideControllerProvider);
    final offerState = ref.watch(driverOfferControllerProvider);

    ref.listen(driverOfferControllerProvider, (previous, next) {
      if (previous?.offer == null && next.offer != null) {
        context.push('/driver/incoming-offer');
      }
    });
    ref.listen(driverRideControllerProvider, (previous, next) => _syncNavigation(next.ride));

    final navState = ref.watch(navigationControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text('Hi, ${user.name}')),
      body: rideState.ride != null
          ? _ActiveRideBody(
              ride: rideState.ride!,
              isActing: rideState.isActing,
              errorMessage: rideState.errorMessage,
              navState: navState,
            )
          : _OfflineOnlineBody(waitingForOffer: offerState.offer != null),
    );
  }
}

class _NotADriverAccount extends StatelessWidget {
  const _NotADriverAccount({required this.onSignOut});

  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.block_rounded, size: 48, color: AppColors.error),
              const SizedBox(height: 16),
              Text('This account is not a driver account', style: AppTextStyles.bodyStrong, textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(
                'Ask an administrator to set this account up as a driver, or sign in with a driver account.',
                style: AppTextStyles.secondary,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              OutlinedButton(onPressed: onSignOut, child: const Text('Sign Out')),
            ],
          ),
        ),
      ),
    );
  }
}

class _OfflineOnlineBody extends ConsumerWidget {
  const _OfflineOnlineBody({required this.waitingForOffer});

  final bool waitingForOffer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusState = ref.watch(driverStatusControllerProvider);
    final isOnline = statusState.availability == DriverAvailability.available;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 160,
              height: 160,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isOnline ? AppColors.ctaGreen.withValues(alpha: 0.12) : AppColors.surfaceTint,
              ),
              child: Icon(
                isOnline ? Icons.directions_car_filled_rounded : Icons.directions_car_outlined,
                size: 72,
                color: isOnline ? AppColors.ctaGreen : AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              isOnline ? (waitingForOffer ? 'Finding you a ride…' : "You're online") : "You're offline",
              style: AppTextStyles.headline.copyWith(fontSize: 22),
            ),
            const SizedBox(height: 6),
            Text(
              isOnline ? 'Waiting for ride requests nearby' : 'Go online to start receiving ride requests',
              style: AppTextStyles.secondary,
              textAlign: TextAlign.center,
            ),
            if (statusState.errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(statusState.errorMessage!, style: AppTextStyles.secondary.copyWith(color: AppColors.error)),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: isOnline ? AppColors.error : AppColors.ctaGreen,
                  minimumSize: const Size(0, 52),
                ),
                onPressed: statusState.isUpdating
                    ? null
                    : () => ref
                        .read(driverStatusControllerProvider.notifier)
                        .setAvailability(isOnline ? DriverAvailability.offline : DriverAvailability.available),
                child: statusState.isUpdating
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : Text(isOnline ? 'Go Offline' : 'Go Online'),
              ),
            ),
            if (!isOnline) ...[
              const SizedBox(height: 12),
              TextButton(
                onPressed: () =>
                    ref.read(driverStatusControllerProvider.notifier).setAvailability(DriverAvailability.onBreak),
                child: const Text('Set On Break instead'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ActiveRideBody extends ConsumerWidget {
  const _ActiveRideBody({
    required this.ride,
    required this.isActing,
    required this.errorMessage,
    required this.navState,
  });

  final Ride ride;
  final bool isActing;
  final String? errorMessage;
  final NavigationState navState;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isEnRouteToPickup = ride.status == RideStatus.driverAssigned || ride.status == RideStatus.driverEnRouteToPickup;
    final isArrived = ride.status == RideStatus.driverArrived;
    final isInProgress = ride.status == RideStatus.rideStarted || ride.status == RideStatus.driverEnRouteToDestination;
    final isNavigating = isEnRouteToPickup || isInProgress;

    final String actionLabel;
    final VoidCallback? onAction;
    final notifier = ref.read(driverRideControllerProvider.notifier);
    if (isEnRouteToPickup || isArrived) {
      actionLabel = isArrived ? 'Start Ride' : "I've Arrived";
      onAction = isActing ? null : () => isArrived ? notifier.startRide() : notifier.markArrived();
    } else {
      actionLabel = 'Complete Ride';
      onAction = isActing ? null : () => notifier.completeRide();
    }

    final destination = isInProgress
        ? LatLng(ride.destinationLatitude, ride.destinationLongitude)
        : null;

    return Column(
      children: [
        Expanded(
          flex: 3,
          child: Stack(
            children: [
              Positioned.fill(
                child: CampusMapPreview(
                  pickup: LatLng(ride.pickupLatitude, ride.pickupLongitude),
                  destination: destination,
                  routePolyline: isNavigating ? navState.route?.polyline : null,
                  center: LatLng(ride.pickupLatitude, ride.pickupLongitude),
                ),
              ),
              if (isNavigating) Positioned(top: 0, left: 0, right: 0, child: _ManeuverBanner(navState: navState)),
            ],
          ),
        ),
        Expanded(
          flex: 2,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 16, offset: Offset(0, -4))],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: const BoxDecoration(color: AppColors.pickupGreen, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        isInProgress
                            ? (ride.destinationLocationName ?? 'Destination')
                            : (ride.pickupLocationName ?? 'Pickup location'),
                        style: AppTextStyles.bodyStrong,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  isInProgress ? 'Dropping off' : (isArrived ? 'Waiting for rider to get on board' : 'Heading to pickup'),
                  style: AppTextStyles.secondary,
                ),
                if (isNavigating && navState.remainingDistanceKm != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${navState.remainingDistanceKm!.toStringAsFixed(1)} km'
                    '${navState.remainingTimeSeconds != null ? ' · ${(navState.remainingTimeSeconds! / 60).ceil()} min' : ''}',
                    style: AppTextStyles.caption,
                  ),
                ],
                if (errorMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(errorMessage!, style: AppTextStyles.secondary.copyWith(color: AppColors.error)),
                ],
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(minimumSize: const Size(0, 52)),
                    onPressed: onAction,
                    child: isActing
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text(actionLabel),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Turn-by-turn instruction card (plan.md Phase 6) - the current maneuver's visual text plus an
/// "Off route" badge while NavigationController is actively rerouting.
class _ManeuverBanner extends StatelessWidget {
  const _ManeuverBanner({required this.navState});

  final NavigationState navState;

  @override
  Widget build(BuildContext context) {
    final maneuver = navState.currentManeuver;
    if (maneuver == null) return const SizedBox.shrink();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: navState.isOffRoute ? AppColors.error : AppColors.ctaGreen,
            borderRadius: BorderRadius.circular(16),
            boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 8)],
          ),
          child: Row(
            children: [
              Icon(
                navState.isOffRoute ? Icons.sync_problem_rounded : Icons.navigation_rounded,
                color: Colors.white,
                size: 32,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  navState.isOffRoute ? 'Rerouting…' : maneuver.instruction,
                  style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
