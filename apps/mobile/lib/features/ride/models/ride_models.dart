import 'package:flutter/material.dart';

/// UI-layer stand-in for the backend's CampusLocation (see
/// apps/api/src/campus/dto/campus-location-response.dto.ts) - swap for the
/// generated API client once this flavor is wired to apps/api.
class CampusLocationUi {
  const CampusLocationUi({
    required this.id,
    required this.name,
    required this.category,
    required this.icon,
    required this.badgeColor,
    required this.latitude,
    required this.longitude,
    this.subtitle,
    this.type,
  });

  final String id;
  final String name;
  final String category;
  final IconData icon;
  final Color badgeColor;
  final double latitude;
  final double longitude;
  final String? subtitle;
  final String? type;
}
