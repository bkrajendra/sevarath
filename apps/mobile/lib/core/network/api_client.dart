import 'package:dio/dio.dart';

import '../config/api_config.dart';
import 'token_storage.dart';

/// Thrown when the stored refresh token is missing or the server rejects
/// it - callers should route to /login when they see this surface as a
/// DioException's `error`.
class SessionExpiredException implements Exception {}

class ApiClient {
  ApiClient({TokenStorage? tokenStorage})
    : _tokenStorage = tokenStorage ?? TokenStorage(),
      _dio = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl)) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStorage.readAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final isAuthEndpoint = error.requestOptions.path.contains('/auth/');
          if (error.response?.statusCode == 401 && !isAuthEndpoint) {
            try {
              await _refreshTokens();
              final retried = await _dio.fetch(error.requestOptions);
              handler.resolve(retried);
              return;
            } catch (_) {
              await _tokenStorage.clear();
              handler.reject(
                DioException(
                  requestOptions: error.requestOptions,
                  error: SessionExpiredException(),
                ),
              );
              return;
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStorage _tokenStorage;

  Dio get dio => _dio;

  Future<void> _refreshTokens() async {
    final refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken == null) {
      throw SessionExpiredException();
    }
    final response = await _dio.post(
      '/auth/refresh',
      data: {'refreshToken': refreshToken},
    );
    final data = response.data as Map<String, dynamic>;
    await _tokenStorage.save(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
  }
}
