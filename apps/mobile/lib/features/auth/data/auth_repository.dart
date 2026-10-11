import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' as firebase_auth;
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/config/google_auth_config.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/token_storage.dart';
import '../models/auth_tokens.dart';
import '../models/user_profile.dart';

/// Outcome of a Google-identity exchange with POST /auth/login (Phase 10.5, docs/plan.md §5).
/// Either a normal successful login, or a brand-new identity with no mobile on file yet - the
/// caller must collect one and retry via [AuthRepository.completeGoogleSignup], passing
/// [firebaseIdToken] back (the backend re-verifies the same token, so nothing is created until
/// the retry succeeds).
class GoogleLoginOutcome {
  const GoogleLoginOutcome.success(this.tokens)
    : requiresMobile = false,
      firebaseIdToken = null,
      suggestedName = null,
      suggestedEmail = null;

  const GoogleLoginOutcome.requiresMobile({
    required this.firebaseIdToken,
    this.suggestedName,
    this.suggestedEmail,
  }) : tokens = null,
       requiresMobile = true;

  final AuthTokens? tokens;
  final bool requiresMobile;
  final String? firebaseIdToken;
  final String? suggestedName;
  final String? suggestedEmail;
}

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

  static bool _googleSignInInitialized = false;

  Future<void> _ensureGoogleSignInInitialized() async {
    if (_googleSignInInitialized) return;
    await GoogleSignIn.instance.initialize(serverClientId: GoogleAuthConfig.webClientId);
    _googleSignInInitialized = true;
  }

  /// Rider-app only (docs/plan.md §5/10.6 - drivers stay mobile/password via the admin console).
  /// Google sign-in -> Firebase credential -> this app's own `/auth/login`. Throws
  /// [AuthException] if the user cancels or the flow otherwise fails.
  Future<GoogleLoginOutcome> loginWithGoogle() async {
    await _ensureGoogleSignInInitialized();
    try {
      final googleAccount = await GoogleSignIn.instance.authenticate();
      final googleIdToken = googleAccount.authentication.idToken;
      if (googleIdToken == null) {
        throw AuthException('Google sign-in did not return an ID token. Please try again.');
      }

      final credential = firebase_auth.GoogleAuthProvider.credential(idToken: googleIdToken);
      final userCredential = await firebase_auth.FirebaseAuth.instance.signInWithCredential(credential);
      final firebaseIdToken = await userCredential.user!.getIdToken();
      if (firebaseIdToken == null) {
        throw AuthException('Could not complete Google sign-in. Please try again.');
      }

      return await _exchangeFirebaseToken(firebaseIdToken);
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) {
        throw AuthException('Sign-in cancelled.');
      }
      throw AuthException('Google sign-in failed: ${e.description ?? e.code}');
    } on firebase_auth.FirebaseAuthException catch (e) {
      throw AuthException(e.message ?? 'Google sign-in failed.');
    }
  }

  /// Completes a Google sign-up after the "add your mobile number" screen - re-sends the same
  /// Firebase ID token (still valid for ~1hr from the original sign-in) plus [mobile]; the
  /// backend only creates the account on this call, never on the first one.
  Future<AuthTokens> completeGoogleSignup({required String firebaseIdToken, required String mobile}) async {
    final outcome = await _exchangeFirebaseToken(firebaseIdToken, mobile: mobile);
    if (outcome.tokens == null) {
      // Should not happen - the backend only re-asks for requiresMobile when mobile is still
      // absent, and this call always supplies one.
      throw AuthException('Could not complete sign-up. Please try again.');
    }
    return outcome.tokens!;
  }

  Future<GoogleLoginOutcome> _exchangeFirebaseToken(String idToken, {String? mobile}) async {
    try {
      final response = await _apiClient.dio.post(
        '/auth/login',
        data: {'idToken': idToken, 'mobile': ?mobile},
      );
      final data = response.data as Map<String, dynamic>;
      if (data['requiresMobile'] == true) {
        return GoogleLoginOutcome.requiresMobile(
          firebaseIdToken: idToken,
          suggestedName: data['name'] as String?,
          suggestedEmail: data['email'] as String?,
        );
      }
      final tokens = AuthTokens.fromJson(data);
      await _tokenStorage.save(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return GoogleLoginOutcome.success(tokens);
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<void> requestPasswordReset({required String identifier}) async {
    try {
      await _apiClient.dio.post(
        '/auth/password-reset/request',
        data: {'identifier': identifier},
      );
    } on DioException catch (e) {
      throw AuthException(messageForAuthError(e));
    }
  }

  Future<void> confirmPasswordReset({
    required String identifier,
    required String code,
    required String newPassword,
  }) async {
    try {
      await _apiClient.dio.post(
        '/auth/password-reset/confirm',
        data: {'identifier': identifier, 'code': code, 'newPassword': newPassword},
      );
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
