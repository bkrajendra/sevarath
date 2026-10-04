import 'package:flutter/material.dart';

/// Brand palette extracted from docs/logo.png and docs/branding-ui.png.
/// Single source of truth for color - never hard-code a hex value outside
/// this file (see docs/architecture.md §7.2 UX guidance).
abstract final class AppColors {
  // Brand (wordmark / primary actions)
  static const Color brandGreen = Color(0xFF14524A);
  static const Color brandGreenDark = Color(0xFF0D3A33);
  static const Color brandGreenLight = Color(0xFF2D7A6B);

  // Brand (sunburst mark)
  static const Color sunRed = Color(0xFFE8451C);
  static const Color sunOrange = Color(0xFFF2690B);
  static const Color sunGold = Color(0xFFFFB302);

  // Call-to-action - a touch brighter than the wordmark green so primary
  // buttons stand out against brandGreen headers/nav.
  static const Color ctaGreen = Color(0xFF1E8A5F);
  static const Color ctaGreenPressed = Color(0xFF156B48);

  // Map/ride semantics
  static const Color pickupGreen = Color(0xFF22A45D);
  static const Color destinationRed = Color(0xFFE94E3C);
  static const Color youAreHereBlue = Color(0xFF2F80ED);
  static const Color ratingGold = Color(0xFFFFC107);

  // Surfaces
  static const Color background = Color(0xFFFAF9F6);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceTint = Color(0xFFF1F7F4);

  // Text
  static const Color textPrimary = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color textOnBrand = Color(0xFFFFFFFF);

  // Lines
  static const Color divider = Color(0xFFE5E7EB);
  static const Color border = Color(0xFFE2E5E1);

  // Status
  static const Color error = Color(0xFFDC2626);
  static const Color warning = Color(0xFFD97706);

  /// Rotating palette for location-category icon badges (Select Destination
  /// list, quick-location chips) - matches the varied teal/orange/purple/
  /// blue/pink badges in branding-ui.png.
  static const List<Color> categoryBadges = [
    Color(0xFF0E9488), // teal
    Color(0xFFD97706), // amber/brown
    Color(0xFF8B5CF6), // purple
    Color(0xFF2F80ED), // blue
    Color(0xFFDB2777), // pink
    Color(0xFF16A34A), // green
  ];
}
