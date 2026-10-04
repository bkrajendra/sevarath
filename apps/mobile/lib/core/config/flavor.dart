/// One Flutter codebase, two build flavors - see docs/plan.md "Flutter project
/// layout" decision and docs/architecture.md §7.2. Each flavor has its own
/// entry point (main_user.dart / main_driver.dart) that sets this before
/// running the shared App widget.
enum Flavor { user, driver }

class FlavorConfig {
  FlavorConfig._({required this.flavor, required this.appName});

  static FlavorConfig? _instance;

  final Flavor flavor;
  final String appName;

  static FlavorConfig get instance {
    final i = _instance;
    if (i == null) {
      throw StateError('FlavorConfig.initialize() must be called before use');
    }
    return i;
  }

  static bool get isDriver => instance.flavor == Flavor.driver;
  static bool get isUser => instance.flavor == Flavor.user;

  static void initialize({required Flavor flavor, required String appName}) {
    _instance = FlavorConfig._(flavor: flavor, appName: appName);
  }
}
