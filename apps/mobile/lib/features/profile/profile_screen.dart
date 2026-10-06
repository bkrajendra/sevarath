import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
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
                child: Icon(
                  Icons.person_rounded,
                  size: 36,
                  color: AppColors.brandGreen,
                ),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    user?.name ?? 'Sevarath user',
                    style: AppTextStyles.headline.copyWith(fontSize: 20),
                  ),
                  Text(
                    'View and manage your profile',
                    style: AppTextStyles.secondary,
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),
          _MenuTile(
            icon: Icons.directions_car_filled_rounded,
            label: 'My Rides',
            // Switching between StatefulShellRoute branches from a screen
            // that's itself inside the shell needs goBranch, not context.go
            // - go() re-resolves the whole router location and silently
            // no-ops here because this branch's own nested Navigator
            // intercepts it first.
            onTap: () => StatefulNavigationShell.of(context).goBranch(1),
          ),
          const _MenuTile(
            icon: Icons.favorite_border_rounded,
            label: 'Favourite Locations',
          ),
          const _MenuTile(
            icon: Icons.notifications_none_rounded,
            label: 'Notifications',
          ),
          const _MenuTile(
            icon: Icons.help_outline_rounded,
            label: 'Help & Support',
          ),
          const _MenuTile(icon: Icons.settings_outlined, label: 'App Settings'),
          const _MenuTile(
            icon: Icons.info_outline_rounded,
            label: 'About Sevarath',
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
      trailing: const Icon(
        Icons.chevron_right_rounded,
        color: AppColors.textSecondary,
      ),
      onTap: onTap ?? () {},
    );
  }
}
