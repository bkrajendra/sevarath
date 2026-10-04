/// Base URL for apps/api. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1` for the Android
/// emulator (which can't reach the host via `localhost`), or similarly for a
/// physical device or real deployment.
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );
}
