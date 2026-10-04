import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the access/refresh JWT pair issued by POST /auth/register and
/// /auth/login/*. Backed by flutter_secure_storage (Keystore/Keychain on
/// mobile; browser storage on web - acceptable for this app's threat model
/// at this stage).
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessKey = 'sevarath_access_token';
  static const _refreshKey = 'sevarath_refresh_token';

  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
