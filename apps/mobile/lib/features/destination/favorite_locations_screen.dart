import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'data/bookmarks_repository.dart';
import 'data/campus_locations_repository.dart';

/// Lists every campus location the rider has favorited (Phase 10.3, docs/plan.md §5) - reached
/// from Profile's "Favourite Locations" tile, which previously had no `onTap` at all (found in
/// live testing, 2026-10-12: "favourite screen in setting is empty or does not open").
///
/// Cross-references [bookmarksControllerProvider] (just ids) against [campusLocationsProvider]
/// (full location details) rather than a separate backend call, so this reuses the same
/// icons/colors the destination picker already shows for the same locations.
class FavoriteLocationsScreen extends ConsumerWidget {
  const FavoriteLocationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookmarksAsync = ref.watch(bookmarksControllerProvider);
    final locationsAsync = ref.watch(campusLocationsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Favourite Locations')),
      body: bookmarksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _ErrorState(
          onRetry: () => ref.invalidate(bookmarksControllerProvider),
        ),
        data: (bookmarkedIds) {
          return locationsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stackTrace) => _ErrorState(
              onRetry: () => ref.invalidate(campusLocationsProvider),
            ),
            data: (locations) {
              final favorites = locations.where((loc) => bookmarkedIds.contains(loc.id)).toList();
              if (favorites.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star_border_rounded, size: 40, color: AppColors.textSecondary),
                        const SizedBox(height: 12),
                        Text('No favourites yet', style: AppTextStyles.bodyStrong),
                        const SizedBox(height: 4),
                        Text(
                          'Tap the star on any location while picking a destination to save it here.',
                          textAlign: TextAlign.center,
                          style: AppTextStyles.secondary,
                        ),
                      ],
                    ),
                  ),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: favorites.length,
                itemBuilder: (context, index) {
                  final loc = favorites[index];
                  return ListTile(
                    leading: Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: loc.badgeColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(loc.icon, color: loc.badgeColor, size: 20),
                    ),
                    title: Text(loc.name, style: AppTextStyles.bodyStrong),
                    subtitle: Text(loc.category, style: AppTextStyles.secondary),
                    trailing: IconButton(
                      icon: const Icon(Icons.star_rounded, color: AppColors.ratingGold),
                      onPressed: () async {
                        final success = await ref.read(bookmarksControllerProvider.notifier).toggle(loc.id);
                        if (!success && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Could not remove favourite. Try again.')),
                          );
                        }
                      },
                    ),
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off_rounded, size: 40, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            Text('Could not load favourites', style: AppTextStyles.bodyStrong),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
