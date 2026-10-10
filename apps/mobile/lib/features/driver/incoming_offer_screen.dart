import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/driver_models.dart';
import 'providers/driver_providers.dart';

/// Shown the instant DriverOfferController reports a pending offer (see driver_home_screen.dart's
/// ref.listen). The system back button is disabled - a driver responds explicitly (accept/
/// reject) or lets the 15s window expire; they don't get to silently swipe away a request.
class IncomingOfferScreen extends ConsumerStatefulWidget {
  const IncomingOfferScreen({super.key});

  @override
  ConsumerState<IncomingOfferScreen> createState() => _IncomingOfferScreenState();
}

class _IncomingOfferScreenState extends ConsumerState<IncomingOfferScreen> {
  Timer? _ticker;
  Duration _remaining = offerResponseWindow;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    final offer = ref.read(driverOfferControllerProvider).offer;
    if (offer == null) return;
    final elapsed = DateTime.now().difference(offer.offeredAt);
    final remaining = offerResponseWindow - elapsed;
    setState(() => _remaining = remaining.isNegative ? Duration.zero : remaining);
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final offerState = ref.watch(driverOfferControllerProvider);
    final offer = offerState.offer;

    // The poll that confirmed this offer was taken/expired already cleared the state - leave
    // this screen rather than show a dead request with no actions.
    ref.listen(driverOfferControllerProvider, (previous, next) {
      if (previous?.offer != null && next.offer == null && context.canPop()) {
        context.pop();
      }
    });

    if (offer == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                const SizedBox(height: 16),
                Text('New Ride Request', style: AppTextStyles.headline.copyWith(fontSize: 22)),
                const SizedBox(height: 24),
                _CountdownRing(remaining: _remaining, total: offerResponseWindow),
                const Spacer(),
                _RouteRow(
                  dotColor: AppColors.pickupGreen,
                  title: offer.pickup.locationName ?? 'Pickup',
                ),
                const Padding(
                  padding: EdgeInsets.only(left: 5),
                  child: SizedBox(height: 16, child: VerticalDivider(thickness: 2, width: 2)),
                ),
                _RouteRow(
                  dotColor: AppColors.destinationRed,
                  title: offer.destination.locationName ?? 'Destination',
                ),
                if (offerState.errorMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    offerState.errorMessage!,
                    style: AppTextStyles.secondary.copyWith(color: AppColors.error),
                  ),
                ],
                const Spacer(),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(foregroundColor: AppColors.error, minimumSize: const Size(0, 52)),
                        onPressed: offerState.isActing
                            ? null
                            : () => ref.read(driverOfferControllerProvider.notifier).reject(),
                        child: const Text('Reject'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(minimumSize: const Size(0, 52)),
                        onPressed: offerState.isActing
                            ? null
                            : () async {
                                final ok = await ref.read(driverOfferControllerProvider.notifier).accept();
                                if (ok && context.mounted && context.canPop()) context.pop();
                              },
                        child: offerState.isActing
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Accept'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CountdownRing extends StatelessWidget {
  const _CountdownRing({required this.remaining, required this.total});

  final Duration remaining;
  final Duration total;

  @override
  Widget build(BuildContext context) {
    final progress = (remaining.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0);
    return SizedBox(
      width: 100,
      height: 100,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: 100,
            height: 100,
            child: CircularProgressIndicator(
              value: progress,
              strokeWidth: 6,
              backgroundColor: AppColors.divider,
              valueColor: AlwaysStoppedAnimation(progress > 0.3 ? AppColors.ctaGreen : AppColors.error),
            ),
          ),
          Text('${remaining.inSeconds}s', style: AppTextStyles.title),
        ],
      ),
    );
  }
}

class _RouteRow extends StatelessWidget {
  const _RouteRow({required this.dotColor, required this.title});

  final Color dotColor;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle)),
        const SizedBox(width: 14),
        Expanded(child: Text(title, style: AppTextStyles.bodyStrong)),
      ],
    );
  }
}
