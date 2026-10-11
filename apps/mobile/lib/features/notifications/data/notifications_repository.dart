import '../../../core/network/api_client.dart';

/// POST/DELETE /notifications/device-tokens (Phase 7 backend, Phase 10.2 client - docs/plan.md
/// §5). Failures here are logged, never surfaced to the user - a missed push-registration call
/// degrades to "no push for this session", not a broken login/logout.
class NotificationsRepository {
  NotificationsRepository({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<void> registerDeviceToken(String token) {
    return _apiClient.dio.post(
      '/notifications/device-tokens',
      data: {'token': token, 'platform': 'ANDROID'},
    );
  }

  Future<void> unregisterDeviceToken(String token) {
    return _apiClient.dio.delete('/notifications/device-tokens', data: {'token': token});
  }
}
