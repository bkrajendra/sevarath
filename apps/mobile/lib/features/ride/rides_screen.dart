import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

class RidesScreen extends ConsumerWidget {
  const RidesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final historyAsync = ref.watch(rideHistoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('My Rides')),
      body: historyAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Could not load your rides', style: AppTextStyles.bodyStrong),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => ref.invalidate(rideHistoryProvider),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (rides) {
          if (rides.isEmpty) {
            return Center(child: Text('No rides yet', style: AppTextStyles.secondary));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(rideHistoryProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: rides.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) => _RideRow(ride: rides[index]),
            ),
          );
        },
      ),
    );
  }
}

class _RideRow extends StatelessWidget {
  const _RideRow({required this.ride});

  final Ride ride;

  @override
  Widget build(BuildContext context) {
    final from = ride.pickupLocationName ?? 'Pickup';
    final to = ride.destinationLocationName ?? 'Destination';
    final when = DateFormat('MMM d · h:mm a').format(ride.requestedAt);

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/ride-details', extra: ride.id),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.surfaceTint,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(_iconForStatus(ride.status), color: AppColors.brandGreen),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('$from → $to', style: AppTextStyles.bodyStrong),
                    Text(when, style: AppTextStyles.caption),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _iconForStatus(RideStatus status) {
    switch (status) {
      case RideStatus.completed:
        return Icons.directions_car_filled_rounded;
      case RideStatus.cancelledByUser:
      case RideStatus.cancelledByDriver:
      case RideStatus.cancelledBySystem:
        return Icons.cancel_outlined;
      case RideStatus.noDriverAvailable:
        return Icons.error_outline_rounded;
      default:
        return Icons.directions_car_filled_rounded;
    }
  }
}
