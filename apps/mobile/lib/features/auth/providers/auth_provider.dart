import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/auth_router_notifier.dart';
import '../data/auth_repository.dart';
import '../models/user_profile.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.errorMessage,
    this.user,
  });

  final AuthStatus status;
  final String? errorMessage;
  final UserProfile? user;

  AuthState copyWith({
    AuthStatus? status,
    String? errorMessage,
    UserProfile? user,
  }) => AuthState(
    status: status ?? this.status,
    errorMessage: errorMessage,
    user: user ?? this.user,
  );
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(),
);

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _bootstrap();
    return const AuthState();
  }

  AuthRepository get _repository => ref.read(authRepositoryProvider);

  Future<void> _bootstrap() async {
    final hasSession = await _repository.hasValidSession();
    state = AuthState(
      status: hasSession
          ? AuthStatus.authenticated
          : AuthStatus.unauthenticated,
    );
    if (hasSession) await _loadUser();
    authRouterNotifier.refresh();
  }

  Future<bool> register({
    required String name,
    required String mobile,
    String? email,
    required String password,
  }) async {
    try {
      await _repository.register(
        name: name,
        mobile: mobile,
        email: email,
        password: password,
      );
      state = const AuthState(status: AuthStatus.authenticated);
      await _loadUser();
      authRouterNotifier.refresh();
      return true;
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
      return false;
    }
  }

  Future<bool> login({
    required String identifier,
    required String password,
  }) async {
    try {
      await _repository.login(identifier: identifier, password: password);
      state = const AuthState(status: AuthStatus.authenticated);
      await _loadUser();
      authRouterNotifier.refresh();
      return true;
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
      return false;
    }
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
    authRouterNotifier.refresh();
  }

  Future<void> _loadUser() async {
    try {
      final user = await _repository.getCurrentUser();
      state = state.copyWith(user: user);
    } catch (_) {
      // Non-fatal - Home/Profile fall back to a generic label if this is null.
    }
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
