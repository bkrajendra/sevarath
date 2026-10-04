import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'models/mock_campus_data.dart';

class RateRideScreen extends StatefulWidget {
  const RateRideScreen({super.key});

  @override
  State<RateRideScreen> createState() => _RateRideScreenState();
}

class _RateRideScreenState extends State<RateRideScreen> {
  int _rating = 4;
  final _tags = <String>{'Courteous'};
  final _commentController = TextEditingController(text: 'Smooth and pleasant ride.');

  static const _allTags = ['Punctual', 'Safe', 'Courteous', 'Clean', 'Comfortable'];
  static const _ratingLabels = {1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent'};

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rate Your Ride')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 28,
                backgroundColor: AppColors.surfaceTint,
                child: Icon(Icons.person_rounded, size: 30, color: AppColors.brandGreen),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(mockDriver.name, style: AppTextStyles.bodyStrong.copyWith(fontSize: 17)),
                  Text('${mockDriver.vehicleCode} · 9 min · 1.2 km', style: AppTextStyles.secondary),
                ],
              ),
            ],
          ),
          const SizedBox(height: 28),
          Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (i) {
                final starIndex = i + 1;
                final filled = starIndex <= _rating;
                return IconButton(
                  // Respond on press, not release - instant visual feedback.
                  onPressed: () => setState(() => _rating = starIndex),
                  iconSize: 36,
                  icon: Icon(
                    filled ? Icons.star_rounded : Icons.star_border_rounded,
                    color: AppColors.ratingGold,
                  ),
                );
              }),
            ),
          ),
          Center(
            child: Text(_ratingLabels[_rating] ?? '', style: AppTextStyles.title),
          ),
          const SizedBox(height: 24),
          Text("Tell us about your experience (optional)", style: AppTextStyles.secondary),
          const SizedBox(height: 8),
          TextField(
            controller: _commentController,
            maxLength: 200,
            maxLines: 3,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _allTags.map((tag) {
              final selected = _tags.contains(tag);
              return FilterChip(
                label: Text(tag),
                selected: selected,
                onSelected: (value) => setState(() {
                  value ? _tags.add(tag) : _tags.remove(tag);
                }),
                selectedColor: AppColors.ctaGreen.withValues(alpha: 0.15),
                checkmarkColor: AppColors.ctaGreen,
                labelStyle: AppTextStyles.secondary.copyWith(
                  color: selected ? AppColors.ctaGreen : AppColors.textPrimary,
                  fontWeight: FontWeight.w600,
                ),
                side: BorderSide(color: selected ? AppColors.ctaGreen : AppColors.border),
                backgroundColor: AppColors.surface,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              );
            }).toList(),
          ),
          const SizedBox(height: 28),
          ElevatedButton(
            onPressed: () => context.go('/home'),
            child: const Text('Submit'),
          ),
        ],
      ),
    );
  }
}
