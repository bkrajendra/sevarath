import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';

class FindingVehicleScreen extends StatefulWidget {
  const FindingVehicleScreen({super.key});

  @override
  State<FindingVehicleScreen> createState() => _FindingVehicleScreenState();
}

class _FindingVehicleScreenState extends State<FindingVehicleScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();

    // Mock flow: auto-advance to the driver screen after "finding" a vehicle.
    Future.delayed(const Duration(milliseconds: 2600), () {
      if (mounted) context.pushReplacement('/driver-en-route');
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
              const _StageStepper(),
              const SizedBox(height: 24),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surfaceTint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.schedule_rounded, color: AppColors.brandGreen),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Estimated arrival', style: AppTextStyles.caption),
                        Text('2 - 4 min', style: AppTextStyles.title),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => context.pop(),
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

class _StageStepper extends StatelessWidget {
  const _StageStepper();

  @override
  Widget build(BuildContext context) {
    const stages = ['Searching', 'Assigning', 'Confirming'];
    return Row(
      children: List.generate(stages.length * 2 - 1, (i) {
        if (i.isOdd) {
          return Expanded(
            child: Container(height: 2, color: i < 1 ? AppColors.ctaGreen : AppColors.divider),
          );
        }
        final index = i ~/ 2;
        final active = index == 0;
        return Column(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: active ? AppColors.ctaGreen : AppColors.surface,
                border: Border.all(color: active ? AppColors.ctaGreen : AppColors.divider, width: 2),
              ),
            ),
            const SizedBox(height: 6),
            Text(stages[index], style: AppTextStyles.caption),
          ],
        );
      }),
    );
  }
}
