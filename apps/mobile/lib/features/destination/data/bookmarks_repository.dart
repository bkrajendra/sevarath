import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Favorited campus_locations (Phase 10.3, docs/plan.md §5) - GET/POST/DELETE
/// /users/me/bookmarks/:campusLocationId.
class BookmarksRepository {
  BookmarksRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  /// The set of bookmarked campus_location ids - all a picker UI needs to know "is this
  /// starred", the location's own name/lat/lng already come from campusLocationsProvider.
  Future<Set<String>> fetchIds() async {
    final response = await _apiClient.dio.get('/users/me/bookmarks');
    final data = response.data as List<dynamic>;
    return data.map((row) => (row as Map<String, dynamic>)['campusLocationId'] as String).toSet();
  }

  Future<void> add(String campusLocationId) {
    return _apiClient.dio.post('/users/me/bookmarks/$campusLocationId');
  }

  Future<void> remove(String campusLocationId) {
    return _apiClient.dio.delete('/users/me/bookmarks/$campusLocationId');
  }
}

final bookmarksRepositoryProvider = Provider<BookmarksRepository>((ref) => BookmarksRepository());

final bookmarkedLocationIdsProvider = FutureProvider<Set<String>>((ref) {
  return ref.read(bookmarksRepositoryProvider).fetchIds();
});
