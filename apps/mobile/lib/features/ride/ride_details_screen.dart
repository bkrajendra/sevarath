import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

class RideDetailsScreen extends ConsumerWidget {
  const RideDetailsScreen({super.key, this.rideId});

  /// Opened from Rides history with a specific past ride's id, or left null to show whatever
  /// RideController currently holds (e.g. right after this ride just completed).
  final String? rideId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentRide = ref.watch(rideControllerProvider).ride;
    final id = rideId ?? currentRide?.id;

    if (id == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Ride Details')),
        body: Center(child: Text('No ride to show', style: AppTextStyles.secondary)),
      );
    }

    if (currentRide != null && currentRide.id == id) {
      return _RideDetailsBody(ride: currentRide);
    }

    final rideAsync = ref.watch(rideByIdProvider(id));
    return rideAsync.when(
      data: (ride) => _RideDetailsBody(ride: ride),
      loading: () => Scaffold(
        appBar: AppBar(title: const Text('Ride Details')),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) => Scaffold(
        appBar: AppBar(title: const Text('Ride Details')),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Could not load this ride', style: AppTextStyles.bodyStrong),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () => ref.invalidate(rideByIdProvider(id)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RideDetailsBody extends StatelessWidget {
  const _RideDetailsBody({required this.ride});

  final Ride ride;

  @override
  Widget build(BuildContext context) {
    final timeFormat = DateFormat('h:mm a');
    final distanceKm =
        Geolocator.distanceBetween(
          ride.pickupLatitude,
          ride.pickupLongitude,
          ride.destinationLatitude,
          ride.destinationLongitude,
        ) /
        1000;
    final duration = (ride.startedAt != null && ride.completedAt != null)
        ? ride.completedAt!.difference(ride.startedAt!)
        : null;
    final isCompleted = ride.status == RideStatus.completed;

    return Scaffold(
      appBar: AppBar(title: const Text('Ride Details')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StopRow(
                    dotColor: AppColors.pickupGreen,
                    title: ride.pickupLocationName ?? 'Pickup',
                    time: timeFormat.format(ride.requestedAt),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(left: 5),
                    child: SizedBox(height: 16, child: VerticalDivider(thickness: 2, width: 2)),
                  ),
                  _StopRow(
                    dotColor: AppColors.destinationRed,
                    title: ride.destinationLocationName ?? 'Destination',
                    time: ride.completedAt != null ? timeFormat.format(ride.completedAt!) : '--',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: (isCompleted ? AppColors.ctaGreen : AppColors.error).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: isCompleted ? AppColors.ctaGreen : AppColors.error,
                  child: Icon(isCompleted ? Icons.check_rounded : Icons.close_rounded, color: Colors.white),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(isCompleted ? 'Ride Completed' : _statusLabel(ride.status), style: AppTextStyles.bodyStrong),
                    Text(
                      duration != null
                          ? '${duration.inMinutes} min · ${distanceKm.toStringAsFixed(1)} km'
                          : '${distanceKm.toStringAsFixed(1)} km',
                      style: AppTextStyles.secondary,
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (ride.driver != null) ...[
            const SizedBox(height: 16),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(
                backgroundColor: AppColors.surfaceTint,
                child: Icon(Icons.person_rounded, color: AppColors.brandGreen),
              ),
              title: Text(ride.driver!.name, style: AppTextStyles.bodyStrong),
              subtitle: Text(ride.vehicleCode ?? ride.driver!.driverCode, style: AppTextStyles.secondary),
            ),
          ],
          const Divider(height: 24),
          if (isCompleted)
            _ActionTile(
              icon: Icons.star_outline_rounded,
              label: 'Rate this ride',
              onTap: () => context.push('/rate-ride'),
            ),
          _ActionTile(icon: Icons.flag_outlined, label: 'Report an issue', onTap: () {}),
          _ActionTile(icon: Icons.help_outline_rounded, label: 'Ride help', onTap: () {}),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => context.go('/home'),
            child: const Text('Book Another Ride'),
          ),
        ],
      ),
    );
  }

  String _statusLabel(RideStatus status) {
    switch (status) {
      case RideStatus.cancelledByUser:
        return 'Cancelled by you';
      case RideStatus.cancelledByDriver:
        return 'Cancelled by driver';
      case RideStatus.cancelledBySystem:
        return 'Cancelled';
      case RideStatus.noDriverAvailable:
        return 'No driver was available';
      default:
        return 'Ride ended';
    }
  }
}

class _StopRow extends StatelessWidget {
  const _StopRow({required this.dotColor, required this.title, required this.time});

  final Color dotColor;
  final String title;
  final String time;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle)),
        const SizedBox(width: 14),
        Expanded(child: Text(title, style: AppTextStyles.bodyStrong)),
        Text(time, style: AppTextStyles.secondary),
      ],
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: AppColors.brandGreen),
      title: Text(label, style: AppTextStyles.body),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
      onTap: onTap,
    );
  }
}
