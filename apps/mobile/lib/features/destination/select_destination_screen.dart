import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../ride/models/ride_models.dart';
import 'data/campus_locations_repository.dart';

class SelectDestinationScreen extends ConsumerStatefulWidget {
  const SelectDestinationScreen({super.key});

  @override
  ConsumerState<SelectDestinationScreen> createState() =>
      _SelectDestinationScreenState();
}

class _SelectDestinationScreenState
    extends ConsumerState<SelectDestinationScreen> {
  final _searchController = TextEditingController();
  String _filter = 'All';
  final _favorites = <String>{};

  static const _filters = ['All', 'Buildings', 'Gates', 'Facilities'];
  static const _facilityTypes = {'PARKING', 'MEDICAL', 'DINING', 'EV_STOP'};

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<CampusLocationUi> _filtered(List<CampusLocationUi> all) {
    final query = _searchController.text.trim().toLowerCase();
    return all.where((loc) {
      final matchesQuery =
          query.isEmpty || loc.name.toLowerCase().contains(query);
      final matchesFilter =
          _filter == 'All' ||
          (_filter == 'Gates' && loc.type == 'GATE') ||
          (_filter == 'Facilities' && _facilityTypes.contains(loc.type)) ||
          (_filter == 'Buildings' &&
              loc.type != 'GATE' &&
              !_facilityTypes.contains(loc.type));
      return matchesQuery && matchesFilter;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final locationsAsync = ref.watch(campusLocationsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Select Destination')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Search building or location...',
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          ),
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final f = _filters[index];
                final selected = f == _filter;
                return ChoiceChip(
                  label: Text(f),
                  selected: selected,
                  onSelected: (_) => setState(() => _filter = f),
                  selectedColor: AppColors.brandGreen,
                  labelStyle: AppTextStyles.secondary.copyWith(
                    color: selected ? Colors.white : AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                  backgroundColor: AppColors.surfaceTint,
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: locationsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.wifi_off_rounded,
                        size: 40,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Could not load locations',
                        style: AppTextStyles.bodyStrong,
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () =>
                            ref.invalidate(campusLocationsProvider),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
              data: (locations) {
                final filtered = _filtered(locations);
                return ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  itemCount: filtered.length + 1,
                  itemBuilder: (context, index) {
                    if (index == filtered.length) {
                      return ListTile(
                        leading: const Icon(
                          Icons.add_location_alt_outlined,
                          color: AppColors.brandGreen,
                        ),
                        title: const Text('Additional Location'),
                        subtitle: const Text('Not available yet - pick a listed location'),
                        enabled: false,
                        trailing: const Icon(Icons.chevron_right_rounded),
                      );
                    }
                    final loc = filtered[index];
                    final isFavorite = _favorites.contains(loc.id);
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
                      subtitle: Text(
                        loc.category,
                        style: AppTextStyles.secondary,
                      ),
                      trailing: IconButton(
                        icon: Icon(
                          isFavorite
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          color: isFavorite
                              ? AppColors.ratingGold
                              : AppColors.textSecondary,
                        ),
                        onPressed: () => setState(() {
                          isFavorite
                              ? _favorites.remove(loc.id)
                              : _favorites.add(loc.id);
                        }),
                      ),
                      onTap: () => context.push('/confirm-ride', extra: loc),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
