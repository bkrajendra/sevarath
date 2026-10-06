import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../ride/models/ride_models.dart';

/// Maps the backend's campus_location_type enum to a presentation icon - the
/// API has no notion of Flutter IconData, so this lookup lives client-side.
const Map<String, IconData> _typeIcons = {
  'GATE': Icons.account_balance,
  'BUILDING': Icons.apartment,
  'OFFICE': Icons.business_center,
  'RESIDENCE': Icons.holiday_village,
  'DINING': Icons.restaurant,
  'PARKING': Icons.local_parking,
  'EV_STOP': Icons.ev_station,
  'MEDICAL': Icons.local_hospital,
  'RECEPTION': Icons.apartment,
  'OTHER': Icons.place,
};

String _titleCase(String enumValue) {
  final words = enumValue.toLowerCase().split('_');
  return words
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}

/// [index] only drives the badge color cycling (AppColors.categoryBadges),
/// so results stay visually varied regardless of list order.
CampusLocationUi campusLocationUiFromJson(
  Map<String, dynamic> json,
  int index,
) {
  final type = json['type'] as String? ?? 'OTHER';
  final description = json['description'] as String?;
  return CampusLocationUi(
    id: json['id'] as String,
    name: json['name'] as String,
    category: (description != null && description.isNotEmpty)
        ? description
        : _titleCase(type),
    icon: _typeIcons[type] ?? Icons.place,
    badgeColor:
        AppColors.categoryBadges[index % AppColors.categoryBadges.length],
    type: type,
  );
}

class CampusLocationsRepository {
  CampusLocationsRepository({ApiClient? apiClient})
    : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<List<CampusLocationUi>> fetchAll() async {
    final response = await _apiClient.dio.get('/campus/locations');
    final data = response.data as List<dynamic>;
    return [
      for (var i = 0; i < data.length; i++)
        campusLocationUiFromJson(data[i] as Map<String, dynamic>, i),
    ];
  }
}

final campusLocationsProvider = FutureProvider<List<CampusLocationUi>>((ref) {
  return CampusLocationsRepository().fetchAll();
});
