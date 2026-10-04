import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/token_storage.dart';
import '../models/auth_tokens.dart';
import '../models/user_profile.dart';

class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Extracts a human-readable message from a failed auth call. NestJS's
/// ValidationPipe returns `message` as a string array for field-validation
/// failures, and as a plain string for thrown exceptions like
/// ConflictException/UnauthorizedException - handle both.
String messageForAuthError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] != null) {
    final message = data['message'];
    if (message is List) return message.join(', ');
    return message.toString();
  }
  return 'Something went wrong. Please try again.';
}

class AuthRepository {
  AuthRepository({ApiClient? apiClient, TokenStorage? tokenStorage})
    : _apiClient = apiClient ?? ApiClient(),
      _tokenStorage = tokenStorage ?? TokenStorage();

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;

  Future<AuthTokens> register({
    required String name,
    required String mobile,
    String? email,
    required String password,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        '/auth/register',
        data: {
          'name': name,
          'mobile': mobile,
          if (email != null && email.isNotEmpty) 'email': email,
          'password': password,
        },
      );
      final tokens = AuthTokens.fromJson(response.data as Map<String, dynamic>);
      await _tokenStorage.save(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      );
      return tokens;
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<AuthTokens> login({
    required String identifier,
    required String password,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        '/auth/login/password',
        data: {'identifier': identifier, 'password': password},
      );
      final tokens = AuthTokens.fromJson(response.data as Map<String, dynamic>);
      await _tokenStorage.save(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      );
      return tokens;
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<UserProfile> getCurrentUser() async {
    final response = await _apiClient.dio.get('/users/me');
    return UserProfile.fromJson(response.data as Map<String, dynamic>);
  }

  Future<bool> hasValidSession() async {
    final token = await _tokenStorage.readAccessToken();
    return token != null;
  }

  Future<void> logout() => _tokenStorage.clear();
}
