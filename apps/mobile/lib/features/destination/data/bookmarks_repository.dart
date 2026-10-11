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

/// Owns the bookmarked-id set and applies toggles optimistically - found in live testing
/// (2026-10-12) that the previous plain FutureProvider, patched only via `ref.invalidate` +
/// full refetch after every toggle, made starring/unstarring feel "very slow" (an extra full
/// round trip after the mutation's own round trip, before the star visually updated). This
/// updates local state immediately on toggle and only talks to the server in the background,
/// reverting on failure.
class BookmarksController extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() {
    return ref.read(bookmarksRepositoryProvider).fetchIds();
  }

  /// Returns true on success, false on failure (caller can show an error) - the local set is
  /// always left correct either way (reverted on failure).
  Future<bool> toggle(String campusLocationId) async {
    final current = state.value ?? const <String>{};
    final wasBookmarked = current.contains(campusLocationId);
    final optimistic = Set<String>.from(current);
    wasBookmarked ? optimistic.remove(campusLocationId) : optimistic.add(campusLocationId);
    state = AsyncData(optimistic);

    try {
      final repository = ref.read(bookmarksRepositoryProvider);
      if (wasBookmarked) {
        await repository.remove(campusLocationId);
      } else {
        await repository.add(campusLocationId);
      }
      return true;
    } catch (_) {
      state = AsyncData(current);
      return false;
    }
  }
}

final bookmarksControllerProvider = AsyncNotifierProvider<BookmarksController, Set<String>>(
  BookmarksController.new,
);
