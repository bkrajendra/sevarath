/// Base URL for apps/api. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1` for the Android
/// emulator (which can't reach the host via `localhost`), or similarly for a
/// physical device or real deployment.
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  /// The real-time gateway's origin + namespace (locations/location.gateway.ts,
  /// `@WebSocketGateway({ namespace: '/ws' })`) - mounted at the server root, not under
  /// [baseUrl]'s `/api/v1` prefix, so this strips any path off [baseUrl] and appends `/ws`.
  static String get wsUrl {
    final uri = Uri.parse(baseUrl);
    return Uri(scheme: uri.scheme, host: uri.host, port: uri.port, path: '/ws').toString();
  }
}
