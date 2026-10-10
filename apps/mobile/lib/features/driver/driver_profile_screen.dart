import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';
import 'providers/driver_providers.dart';

/// Trimmed down from the rider ProfileScreen - no "My Rides"/"Favourite Locations" tiles,
/// those are rider concepts with no driver-side equivalent today.
class DriverProfileScreen extends ConsumerWidget {
  const DriverProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final profileAsync = ref.watch(driverProfileProvider);
    final vehicleAsync = ref.watch(assignedVehicleProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 32,
                backgroundColor: AppColors.surfaceTint,
                child: Icon(Icons.person_rounded, size: 36, color: AppColors.brandGreen),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user?.name ?? 'Driver', style: AppTextStyles.headline.copyWith(fontSize: 20)),
                  profileAsync.when(
                    data: (profile) => Text('Driver account · ${profile.driverCode}', style: AppTextStyles.secondary),
                    loading: () => Text('Driver account', style: AppTextStyles.secondary),
                    error: (error, stackTrace) => Text('Driver account', style: AppTextStyles.secondary),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surfaceTint,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(Icons.directions_bus_filled_rounded, color: AppColors.brandGreen),
                const SizedBox(width: 12),
                Expanded(
                  child: vehicleAsync.when(
                    data: (vehicle) => vehicle == null
                        ? Text('No vehicle assigned yet', style: AppTextStyles.secondary)
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(vehicle.vehicleCode, style: AppTextStyles.bodyStrong),
                              if (vehicle.registrationNumber != null)
                                Text(vehicle.registrationNumber!, style: AppTextStyles.secondary),
                            ],
                          ),
                    loading: () => Text('Loading vehicle…', style: AppTextStyles.secondary),
                    error: (error, stackTrace) => Text('Could not load vehicle', style: AppTextStyles.secondary),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const _MenuTile(icon: Icons.help_outline_rounded, label: 'Help & Support'),
          _MenuTile(
            icon: Icons.info_outline_rounded,
            label: 'About Sevarath',
            onTap: () => context.push('/about'),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () async {
                await ref.read(authControllerProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              },
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
              child: const Text('Sign Out'),
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({required this.icon, required this.label, this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: AppColors.brandGreen),
      title: Text(label, style: AppTextStyles.body),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
      onTap: onTap ?? () {},
    );
  }
}
