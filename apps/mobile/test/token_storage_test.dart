import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:sevarath_mobile/core/network/token_storage.dart';

class _FakeSecureStorage extends FlutterSecureStoragePlatform {
  final Map<String, String> _data = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    required Map<String, String> options,
  }) async {
    if (value == null) {
      _data.remove(key);
    } else {
      _data[key] = value;
    }
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async => _data[key];

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    _data.remove(key);
  }

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => _data.containsKey(key);

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => Map<String, String>.from(_data);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    _data.clear();
  }
}

void main() {
  late TokenStorage storage;

  setUp(() {
    FlutterSecureStoragePlatform.instance = _FakeSecureStorage();
    storage = TokenStorage();
  });

  test('save then read round-trips both tokens', () async {
    await storage.save(accessToken: 'access-123', refreshToken: 'refresh-456');

    expect(await storage.readAccessToken(), 'access-123');
    expect(await storage.readRefreshToken(), 'refresh-456');
  });

  test('clear removes both tokens', () async {
    await storage.save(accessToken: 'access-123', refreshToken: 'refresh-456');
    await storage.clear();

    expect(await storage.readAccessToken(), isNull);
    expect(await storage.readRefreshToken(), isNull);
  });
}
