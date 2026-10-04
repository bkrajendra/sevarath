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
    this.subtitle,
  });

  final String id;
  final String name;
  final String category;
  final IconData icon;
  final Color badgeColor;
  final String? subtitle;
}

class RideDriverUi {
  const RideDriverUi({
    required this.name,
    required this.rating,
    required this.ridesCount,
    required this.vehicleCode,
  });

  final String name;
  final double rating;
  final int ridesCount;
  final String vehicleCode;
}

enum RideSearchStage { searching, assigning, confirming }
