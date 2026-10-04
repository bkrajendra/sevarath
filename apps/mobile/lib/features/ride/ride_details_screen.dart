import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/mock_campus_data.dart';

class RideDetailsScreen extends StatelessWidget {
  const RideDetailsScreen({super.key});

  @override
  Widget build(BuildContext context) {
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
                  _StopRow(dotColor: AppColors.pickupGreen, title: 'Main Gate', time: '9:32 AM'),
                  const Padding(
                    padding: EdgeInsets.only(left: 5),
                    child: SizedBox(height: 16, child: VerticalDivider(thickness: 2, width: 2)),
                  ),
                  _StopRow(dotColor: AppColors.destinationRed, title: 'Shantivan', time: '9:41 AM'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.ctaGreen.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const CircleAvatar(
                  backgroundColor: AppColors.ctaGreen,
                  child: Icon(Icons.check_rounded, color: Colors.white),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Ride Completed', style: AppTextStyles.bodyStrong),
                    Text('9 min · 1.2 km', style: AppTextStyles.secondary),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const CircleAvatar(
              backgroundColor: AppColors.surfaceTint,
              child: Icon(Icons.person_rounded, color: AppColors.brandGreen),
            ),
            title: Text(mockDriver.name, style: AppTextStyles.bodyStrong),
            subtitle: Text(mockDriver.vehicleCode, style: AppTextStyles.secondary),
          ),
          const Divider(height: 24),
          _ActionTile(icon: Icons.star_outline_rounded, label: 'Rate this ride', onTap: () => context.push('/rate-ride')),
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
