import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../../shared/widgets/campus_map_preview.dart';

class ConfirmRideScreen extends StatelessWidget {
  const ConfirmRideScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: Stack(
              children: [
                const Positioned.fill(
                  child: CampusMapPreview(
                    pickup: LatLng(24.4828, 72.7820),
                    destination: LatLng(24.4850, 72.7850),
                  ),
                ),
                Positioned(
                  top: 0,
                  left: 0,
                  // A bare (non-Positioned) Stack child makes the Stack
                  // shrink-wrap to that child's size instead of filling the
                  // Expanded area, which was squashing the map next to it
                  // down to the back button's own width. Positioned keeps
                  // the Stack sized to its full constraints.
                  child: SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: _BackButton(onTap: () => context.pop()),
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
                boxShadow: [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 16,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _RouteRow(
                    dotColor: AppColors.pickupGreen,
                    title: 'Main Gate',
                    subtitle: 'Headquarters',
                  ),
                  const Padding(
                    padding: EdgeInsets.only(left: 5),
                    child: SizedBox(
                      height: 16,
                      child: VerticalDivider(thickness: 2, width: 2),
                    ),
                  ),
                  _RouteRow(
                    dotColor: AppColors.destinationRed,
                    title: 'Shantivan',
                    subtitle: 'Meditation Complex',
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Icon(
                        Icons.directions_car_filled_rounded,
                        size: 18,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(width: 6),
                      Text('1.2 km', style: AppTextStyles.secondary),
                      const SizedBox(width: 16),
                      const Icon(
                        Icons.access_time_rounded,
                        size: 18,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(width: 6),
                      Text('~ 4 min', style: AppTextStyles.secondary),
                    ],
                  ),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => context.push('/finding-vehicle'),
                      child: const Text('Request Ride'),
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

class _RouteRow extends StatelessWidget {
  const _RouteRow({
    required this.dotColor,
    required this.title,
    required this.subtitle,
  });

  final Color dotColor;
  final String title;
  final String subtitle;

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
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: AppTextStyles.bodyStrong),
            Text(subtitle, style: AppTextStyles.caption),
          ],
        ),
      ],
    );
  }
}

class _BackButton extends StatelessWidget {
  const _BackButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: const Padding(
          padding: EdgeInsets.all(10),
          child: Icon(Icons.arrow_back_rounded, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}
