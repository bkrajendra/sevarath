import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';

class WhereToCard extends StatelessWidget {
  const WhereToCard({super.key, required this.onTap, this.pickupLabel = 'Current Location'});

  final VoidCallback onTap;
  final String pickupLabel;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Where would you like to go?', style: AppTextStyles.title),
              const SizedBox(height: 16),
              _LocationRow(
                dotColor: AppColors.pickupGreen,
                label: 'Pickup Location',
                value: pickupLabel,
              ),
              Padding(
                padding: const EdgeInsets.only(left: 5),
                child: SizedBox(
                  height: 18,
                  child: VerticalDivider(
                    color: AppColors.divider,
                    thickness: 2,
                    width: 2,
                  ),
                ),
              ),
              _LocationRow(
                dotColor: AppColors.destinationRed,
                label: 'Destination',
                value: 'Select destination',
                valueIsPlaceholder: true,
                trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationRow extends StatelessWidget {
  const _LocationRow({
    required this.dotColor,
    required this.label,
    required this.value,
    this.valueIsPlaceholder = false,
    this.trailing,
  });

  final Color dotColor;
  final String label;
  final String value;
  final bool valueIsPlaceholder;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppTextStyles.caption),
              Text(
                value,
                style: valueIsPlaceholder
                    ? AppTextStyles.body.copyWith(color: AppColors.textSecondary)
                    : AppTextStyles.bodyStrong,
              ),
            ],
          ),
        ),
        ?trailing,
      ],
    );
  }
}
