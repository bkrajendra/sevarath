import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../../shared/widgets/campus_map_preview.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

class DriverEnRouteScreen extends ConsumerWidget {
  const DriverEnRouteScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rideState = ref.watch(rideControllerProvider);
    final ride = rideState.ride;

    ref.listen(rideControllerProvider, (previous, next) {
      if (next.ride?.status == RideStatus.rideStarted) {
        context.pushReplacement('/on-the-way');
      }
    });

    if (ride == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Driver En Route')),
        body: Center(child: ElevatedButton(onPressed: () => context.go('/home'), child: const Text('Back to Home'))),
      );
    }

    final driver = ride.driver;
    final liveLocation = rideState.driverLocation?.rideId == ride.id ? rideState.driverLocation : null;
    final vehiclePosition = liveLocation != null
        ? LatLng(liveLocation.latitude, liveLocation.longitude)
        : null;
    final arrived = ride.status == RideStatus.driverArrived;

    return Scaffold(
      appBar: AppBar(title: const Text('Driver En Route')),
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: Stack(
              children: [
                Positioned.fill(
                  child: CampusMapPreview(
                    pickup: LatLng(ride.pickupLatitude, ride.pickupLongitude),
                    vehiclePosition: vehiclePosition,
                    center: LatLng(ride.pickupLatitude, ride.pickupLongitude),
                  ),
                ),
                if (arrived)
                  Positioned(
                    top: 16,
                    right: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.ctaGreen,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6)],
                      ),
                      child: const Text(
                        'Arrived',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
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
                      const CircleAvatar(
                        radius: 28,
                        backgroundColor: AppColors.surfaceTint,
                        child: Icon(Icons.person_rounded, size: 30, color: AppColors.brandGreen),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(driver?.name ?? 'Driver assigned', style: AppTextStyles.bodyStrong),
                            if (driver != null) ...[
                              Text(driver.mobile, style: AppTextStyles.secondary),
                              Text('ID: ${driver.driverCode}', style: AppTextStyles.caption),
                            ],
                          ],
                        ),
                      ),
                      if (ride.vehicleRegistrationNumber != null || ride.vehicleCode != null)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceTint,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.directions_bus_filled_rounded, size: 16, color: AppColors.brandGreen),
                              const SizedBox(width: 4),
                              Text(
                                ride.vehicleRegistrationNumber ?? ride.vehicleCode!,
                                style: AppTextStyles.caption,
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceTint,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.timelapse_rounded, size: 18, color: AppColors.brandGreen),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            arrived
                                ? 'Your driver has arrived at ${ride.pickupLocationName ?? 'the pickup point'}'
                                : 'On the way to ${ride.pickupLocationName ?? 'your pickup point'}',
                            style: AppTextStyles.secondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () async {
                        final cancelled = await ref.read(rideControllerProvider.notifier).cancelRide();
                        if (cancelled && context.mounted) context.go('/home');
                      },
                      style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
                      child: const Text('Cancel Ride'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
