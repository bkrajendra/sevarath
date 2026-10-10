import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

/// Watches the real ride (created by ConfirmRideScreen, kept in sync over the /ws gateway +
/// REST fallback by RideController) and reacts to its actual status - no timer, no auto-advance.
class FindingVehicleScreen extends ConsumerStatefulWidget {
  const FindingVehicleScreen({super.key});

  @override
  ConsumerState<FindingVehicleScreen> createState() => _FindingVehicleScreenState();
}

class _FindingVehicleScreenState extends ConsumerState<FindingVehicleScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ride = ref.watch(rideControllerProvider).ride;

    ref.listen(rideControllerProvider, (previous, next) {
      final status = next.ride?.status;
      if (status == RideStatus.driverAssigned || status == RideStatus.driverEnRouteToPickup) {
        context.pushReplacement('/driver-en-route');
      }
    });

    if (ride == null) {
      // Shouldn't normally happen (this screen is only reached after a successful
      // requestRide()), but handle it rather than crash on a null ride.
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('No active ride', style: AppTextStyles.bodyStrong),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: () => context.go('/home'), child: const Text('Back to Home')),
              ],
            ),
          ),
        ),
      );
    }

    if (ride.status == RideStatus.noDriverAvailable) {
      return _NoDriverAvailable(onRetry: () => context.pop());
    }

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(height: 24),
              Text('Finding a nearby vehicle…', style: AppTextStyles.headline.copyWith(fontSize: 20)),
              const SizedBox(height: 6),
              Text(
                "Please wait, we're assigning the nearest EV",
                style: AppTextStyles.secondary,
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              SizedBox(
                width: 220,
                height: 220,
                child: AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final t = _pulseController.value;
                    final t2 = (t + 0.5) % 1.0;
                    return Stack(
                      alignment: Alignment.center,
                      children: [
                        _pulseRing(progress: t),
                        _pulseRing(progress: t2),
                        Container(
                          width: 140,
                          height: 140,
                          decoration: const BoxDecoration(
                            color: AppColors.surfaceTint,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.directions_bus_filled_rounded,
                            size: 56,
                            color: AppColors.brandGreen,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
              const Spacer(),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () async {
                    final cancelled = await ref.read(rideControllerProvider.notifier).cancelRide();
                    if (cancelled && context.mounted) context.pop();
                  },
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
                  child: const Text('Cancel Request'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// One expanding, fading ring at [progress] (0 = just born at the center
  /// icon's edge, 1 = fully expanded and transparent).
  Widget _pulseRing({required double progress}) {
    return Opacity(
      opacity: (1 - progress).clamp(0, 1),
      child: Transform.scale(
        scale: 1.0 + progress * 0.6,
        child: Container(
          width: 140,
          height: 140,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.ctaGreen, width: 2),
          ),
        ),
      ),
    );
  }
}

class _NoDriverAvailable extends ConsumerWidget {
  const _NoDriverAvailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.directions_car_outlined, size: 48, color: AppColors.textSecondary),
              const SizedBox(height: 16),
              Text('No vehicle available right now', style: AppTextStyles.bodyStrong, textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(
                'Every nearby EV is busy or out of range. Please try again shortly.',
                style: AppTextStyles.secondary,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () {
                  ref.read(rideControllerProvider.notifier).clear();
                  onRetry();
                },
                child: const Text('Go Back'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
