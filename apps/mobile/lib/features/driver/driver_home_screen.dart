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

class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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

    return Scaffold(
      appBar: AppBar(title: Text('Hi, ${user.name}')),
      body: rideState.ride != null
          ? _ActiveRideBody(ride: rideState.ride!, isActing: rideState.isActing, errorMessage: rideState.errorMessage)
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
  const _ActiveRideBody({required this.ride, required this.isActing, required this.errorMessage});

  final Ride ride;
  final bool isActing;
  final String? errorMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isEnRouteToPickup = ride.status == RideStatus.driverAssigned || ride.status == RideStatus.driverEnRouteToPickup;
    final isArrived = ride.status == RideStatus.driverArrived;
    final isInProgress = ride.status == RideStatus.rideStarted || ride.status == RideStatus.driverEnRouteToDestination;

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
          child: CampusMapPreview(
            pickup: LatLng(ride.pickupLatitude, ride.pickupLongitude),
            destination: destination,
            center: LatLng(ride.pickupLatitude, ride.pickupLongitude),
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
