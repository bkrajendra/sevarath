import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../ride/models/mock_campus_data.dart';
import '../ride/models/ride_models.dart';

class SelectDestinationScreen extends StatefulWidget {
  const SelectDestinationScreen({super.key});

  @override
  State<SelectDestinationScreen> createState() => _SelectDestinationScreenState();
}

class _SelectDestinationScreenState extends State<SelectDestinationScreen> {
  final _searchController = TextEditingController();
  String _filter = 'All';
  final _favorites = <String>{};

  static const _filters = ['All', 'Buildings', 'Gates', 'Facilities'];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<CampusLocationUi> get _filtered {
    final query = _searchController.text.trim().toLowerCase();
    return mockCampusLocations.where((loc) {
      final matchesQuery = query.isEmpty || loc.name.toLowerCase().contains(query);
      final matchesFilter = _filter == 'All' ||
          (_filter == 'Gates' && loc.id == 'main-gate') ||
          (_filter == 'Buildings' && !['main-gate', 'parking'].contains(loc.id)) ||
          (_filter == 'Facilities' && ['parking', 'hospital', 'dining-hall'].contains(loc.id));
      return matchesQuery && matchesFilter;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
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
                prefixIcon: Icon(Icons.search_rounded, color: AppColors.textSecondary),
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
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              itemCount: _filtered.length + 1,
              itemBuilder: (context, index) {
                if (index == _filtered.length) {
                  return ListTile(
                    leading: const Icon(Icons.add_location_alt_outlined, color: AppColors.brandGreen),
                    title: const Text('Additional Location'),
                    subtitle: const Text('Enter custom location'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => context.push('/confirm-ride'),
                  );
                }
                final loc = _filtered[index];
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
                  subtitle: Text(loc.category, style: AppTextStyles.secondary),
                  trailing: IconButton(
                    icon: Icon(
                      isFavorite ? Icons.star_rounded : Icons.star_border_rounded,
                      color: isFavorite ? AppColors.ratingGold : AppColors.textSecondary,
                    ),
                    onPressed: () => setState(() {
                      isFavorite ? _favorites.remove(loc.id) : _favorites.add(loc.id);
                    }),
                  ),
                  onTap: () => context.push('/confirm-ride'),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
