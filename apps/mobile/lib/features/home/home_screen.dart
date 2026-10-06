import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../auth/providers/auth_provider.dart';
import '../ride/models/mock_campus_data.dart';
import 'widgets/quick_location_chip.dart';
import 'widgets/where_to_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final quickLocations = mockCampusLocations.take(6).toList();
    final recentPlaces = mockCampusLocations.skip(1).take(3).toList();

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          children: [
            Row(
              children: [
                const CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.surfaceTint,
                  child: Icon(
                    Icons.person_rounded,
                    color: AppColors.brandGreen,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Good Morning', style: AppTextStyles.secondary),
                      Text(
                        user?.name ?? 'there',
                        style: AppTextStyles.headline.copyWith(fontSize: 20),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () {},
                  icon: const Icon(Icons.notifications_none_rounded),
                  color: AppColors.textPrimary,
                ),
              ],
            ),
            const SizedBox(height: 20),
            WhereToCard(onTap: () => context.push('/select-destination')),
            const SizedBox(height: 24),
            Text('Quick Locations', style: AppTextStyles.title),
            const SizedBox(height: 4),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: quickLocations.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisExtent: 104,
              ),
              itemBuilder: (context, index) {
                final loc = quickLocations[index];
                return QuickLocationChip(
                  location: loc,
                  onTap: () => context.push('/select-destination'),
                );
              },
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Recent Places', style: AppTextStyles.title),
                TextButton(onPressed: () {}, child: const Text('View All')),
              ],
            ),
            ...recentPlaces.map(
              (loc) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceTint,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.location_on_outlined,
                      color: AppColors.brandGreen,
                    ),
                  ),
                  title: Text(loc.name, style: AppTextStyles.bodyStrong),
                  subtitle: Text(loc.category, style: AppTextStyles.secondary),
                  onTap: () => context.push('/select-destination'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
