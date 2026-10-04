import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'ride_models.dart';

/// Placeholder data standing in for GET /api/v1/campus/locations until this
/// flavor is wired to apps/api (see docs/plan.md Phase 3).
final List<CampusLocationUi> mockCampusLocations = [
  CampusLocationUi(
    id: 'main-gate',
    name: 'Main Gate',
    category: 'Headquarters',
    icon: Icons.account_balance,
    badgeColor: AppColors.categoryBadges[0],
  ),
  CampusLocationUi(
    id: 'reception',
    name: 'Reception',
    category: 'Administration',
    icon: Icons.apartment,
    badgeColor: AppColors.categoryBadges[1],
  ),
  CampusLocationUi(
    id: 'shantivan',
    name: 'Shantivan',
    category: 'Meditation Complex',
    icon: Icons.self_improvement,
    badgeColor: AppColors.categoryBadges[2],
  ),
  CampusLocationUi(
    id: 'gyan-sarovar',
    name: 'Gyan Sarovar',
    category: 'Lake Area',
    icon: Icons.water,
    badgeColor: AppColors.categoryBadges[3],
  ),
  CampusLocationUi(
    id: 'tapovan',
    name: 'Tapovan',
    category: 'Accommodation',
    icon: Icons.holiday_village,
    badgeColor: AppColors.categoryBadges[4],
  ),
  CampusLocationUi(
    id: 'dining-hall',
    name: 'Dining Hall',
    category: 'Food Court',
    icon: Icons.restaurant,
    badgeColor: AppColors.categoryBadges[5],
  ),
  CampusLocationUi(
    id: 'hospital',
    name: 'Hospital',
    category: 'Medical Services',
    icon: Icons.local_hospital,
    badgeColor: AppColors.categoryBadges[1],
  ),
  CampusLocationUi(
    id: 'parking',
    name: 'Parking Area',
    category: 'EV Parking',
    icon: Icons.local_parking,
    badgeColor: AppColors.categoryBadges[3],
  ),
  CampusLocationUi(
    id: 'om-shanti-bhawan',
    name: 'Om Shanti Bhawan',
    category: 'Conference Hall',
    icon: Icons.meeting_room,
    badgeColor: AppColors.categoryBadges[2],
  ),
];

const RideDriverUi mockDriver = RideDriverUi(
  name: 'Suresh Kumar',
  rating: 4.9,
  ridesCount: 124,
  vehicleCode: 'EV-03',
);
