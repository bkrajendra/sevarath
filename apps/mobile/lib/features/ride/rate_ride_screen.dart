import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'data/rides_repository.dart';
import 'models/ride.dart';
import 'providers/ride_provider.dart';

/// Wired to POST /rides/:id/rating (Phase 10.3, docs/plan.md §5) - rating and feedback are one
/// combined submission, not two separate mechanisms: the tag chips below are folded into the
/// submitted comment text, there's no separate tags column on the backend.
///
/// Takes [ride] directly from the caller (RideDetailsScreen, which already has it whether that
/// screen opened for the just-completed ride or an old one from history) rather than reading
/// `rideControllerProvider` - that provider only ever tracks the current *active* ride, so for
/// any ride opened from history it was null, and Submit silently no-op'd (found in live testing,
/// 2026-10-12: "nothing happened" / "no success or error screen").
class RateRideScreen extends ConsumerStatefulWidget {
  const RateRideScreen({super.key, required this.ride});

  final Ride ride;

  @override
  ConsumerState<RateRideScreen> createState() => _RateRideScreenState();
}

class _RateRideScreenState extends ConsumerState<RateRideScreen> {
  final _ridesRepository = RidesRepository();
  int _rating = 5;
  final _tags = <String>{};
  final _commentController = TextEditingController();
  bool _submitting = false;

  static const _allTags = ['Punctual', 'Safe', 'Courteous', 'Clean', 'Comfortable'];
  static const _ratingLabels = {1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent'};

  String? get _combinedComment {
    final tagsText = _tags.isEmpty ? '' : _tags.join(', ');
    final freeText = _commentController.text.trim();
    final parts = [if (tagsText.isNotEmpty) tagsText, if (freeText.isNotEmpty) freeText];
    return parts.isEmpty ? null : parts.join(' — ');
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await _ridesRepository.rateRide(widget.ride.id, rating: _rating, comment: _combinedComment);
      if (!mounted) return;
      // The rated ride, if it's also the one RideController is still actively tracking (the
      // just-completed-ride flow), is fully done now - clear it so Home stops offering to
      // "resume" it. Left alone for an unrelated old ride opened from history.
      if (ref.read(rideControllerProvider).ride?.id == widget.ride.id) {
        ref.read(rideControllerProvider.notifier).clear();
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Thanks for your feedback!')),
      );
      context.pop();
    } on RideException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final driver = widget.ride.driver;
    final vehicleCode = widget.ride.vehicleCode;

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
                  Text(driver?.name ?? 'Your driver', style: AppTextStyles.bodyStrong.copyWith(fontSize: 17)),
                  if (vehicleCode != null) Text(vehicleCode, style: AppTextStyles.secondary),
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
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Submit'),
          ),
        ],
      ),
    );
  }
}
