import 'package:flutter/foundation.dart';

/// Bridges AuthController's Riverpod state to GoRouter's `refreshListenable`.
/// `notifyListeners()` is `@protected` on ChangeNotifier, so this subclass
/// exposes it as `refresh()` for callers outside the class.
class AuthRouterNotifier extends ChangeNotifier {
  void refresh() => notifyListeners();
}

final authRouterNotifier = AuthRouterNotifier();
