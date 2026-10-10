import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../../shared/widgets/campus_map_preview.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

/// Ride is physically underway (RIDE_STARTED / DRIVER_EN_ROUTE_TO_DESTINATION) - no rider
/// action exists here (cancel is only valid up to DRIVER_ARRIVED, ride-state-machine.ts's
/// CANCELLABLE_RIDE_STATUSES; `complete` is a driver-only endpoint). This screen is a pure,
/// live status display until the driver's own `complete` call fires RideCompleted.
class OnTheWayScreen extends ConsumerWidget {
  const OnTheWayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rideState = ref.watch(rideControllerProvider);
    final ride = rideState.ride;

    ref.listen(rideControllerProvider, (previous, next) {
      if (next.ride?.status == RideStatus.completed) {
        context.pushReplacement('/ride-details', extra: next.ride!.id);
      }
    });

    if (ride == null) {
      return Scaffold(
        body: Center(child: ElevatedButton(onPressed: () => context.go('/home'), child: const Text('Back to Home'))),
      );
    }

    final liveLocation = rideState.driverLocation?.rideId == ride.id ? rideState.driverLocation : null;
    final vehiclePosition = liveLocation != null ? LatLng(liveLocation.latitude, liveLocation.longitude) : null;
    final remainingKm = liveLocation != null
        ? Geolocator.distanceBetween(
              liveLocation.latitude,
              liveLocation.longitude,
              ride.destinationLatitude,
              ride.destinationLongitude,
            ) /
            1000
        : null;

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: CampusMapPreview(
              pickup: LatLng(ride.pickupLatitude, ride.pickupLongitude),
              destination: LatLng(ride.destinationLatitude, ride.destinationLongitude),
              vehiclePosition: vehiclePosition,
              center: vehiclePosition ?? LatLng(ride.pickupLatitude, ride.pickupLongitude),
              zoom: 16.5,
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            // A bare (non-Positioned) Stack child makes the Stack
            // shrink-wrap to that child instead of filling the screen,
            // which squashes the map beside it down to this banner's width.
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.ctaGreen,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: const [
                      BoxShadow(color: Colors.black26, blurRadius: 8),
                    ],
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.directions_car_filled_rounded,
                        color: Colors.white,
                        size: 32,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'On the way',
                              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                            ),
                            Text(
                              'Heading to ${ride.destinationLocationName ?? 'your destination'}',
                              style: const TextStyle(color: Colors.white, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: Container(
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: const [
                    BoxShadow(color: Colors.black12, blurRadius: 12),
                  ],
                ),
                child: Row(
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          remainingKm != null ? '${remainingKm.toStringAsFixed(1)} km remaining' : 'Ride in progress',
                          style: AppTextStyles.title,
                        ),
                        Text(ride.vehicleCode ?? '', style: AppTextStyles.caption),
                      ],
                    ),
                    const Spacer(),
                    const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
