import 'package:dio/dio.dart';

import '../models/github_contributor.dart';

/// The real GitHub repo backing this app - github.com/bkrajendra/sevarath, public, so its
/// contributors list is readable without auth (no sevarath API token belongs anywhere near
/// this call, hence a fresh Dio instance here rather than reusing ApiClient).
const sevarathRepoOwner = 'bkrajendra';
const sevarathRepoName = 'sevarath';
const sevarathRepoUrl = 'https://github.com/$sevarathRepoOwner/$sevarathRepoName';

class GitHubException implements Exception {
  GitHubException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Fetches this repo's real contributor list - features/about/about_screen.dart deliberately
/// never ships a placeholder/mock contributor list, only this.
class GitHubRepository {
  GitHubRepository({Dio? dio})
    : _dio = dio ?? Dio(BaseOptions(baseUrl: 'https://api.github.com'));

  final Dio _dio;

  Future<List<GitHubContributor>> getContributors() async {
    try {
      final response = await _dio.get('/repos/$sevarathRepoOwner/$sevarathRepoName/contributors');
      final data = response.data as List<dynamic>;
      return data
          .map((json) => GitHubContributor.fromJson(json as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => b.contributions.compareTo(a.contributions));
    } on DioException catch (e) {
      throw GitHubException(e.message ?? 'Could not load contributors.');
    }
  }
}
