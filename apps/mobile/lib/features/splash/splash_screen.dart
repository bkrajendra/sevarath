import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_colors.dart';
import '../../shared/widgets/sevarath_mark.dart';
import '../auth/providers/auth_provider.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<double> _scale;

  /// Was stuck looking frozen on a slow first-ever cold start (observed 2026-10-10): this
  /// screen used to leave for /home on a bare 2s timer regardless of whether
  /// AuthController's bootstrap (reading flutter_secure_storage, which on Android can take
  /// well over a second on its very first-ever access while it initializes the Keystore
  /// cipher) had actually finished. app_router.dart's redirect bounces an "isLoading" /home
  /// navigation straight back to /splash, so a slow bootstrap made this look stuck rather
  /// than just slow. Now this waits for both the minimum branding delay *and* a resolved
  /// auth status before navigating, so it never races the router's own redirect logic.
  bool _minDelayElapsed = false;

  @override
  void initState() {
    super.initState();
    // Critically damped entrance (no overshoot) - this is a passive arrival,
    // not something the user flicked, so no bounce. See apple-design skill.
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.92, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );
    _controller.forward();

    Future.delayed(const Duration(milliseconds: 2000), () {
      if (!mounted) return;
      _minDelayElapsed = true;
      _maybeNavigate();
    });
  }

  void _maybeNavigate() {
    if (!_minDelayElapsed) return;
    if (ref.read(authControllerProvider).status == AuthStatus.unknown) return;
    context.go('/home');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authControllerProvider, (previous, next) {
      if (next.status != AuthStatus.unknown) _maybeNavigate();
    });

    return Scaffold(
      body: DecoratedBox(
        // Placeholder for a real campus hero photo (golden-hour Shantivan,
        // see branding-ui.png slide 1) - swap the gradient for Image.asset
        // once campus photography is available.
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFBFE0F0), Color(0xFFEFE3C8), Color(0xFFDCEBD8)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: FadeTransition(
              opacity: _fade,
              child: ScaleTransition(
                scale: _scale,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SevarathMark(size: 120),
                    const SizedBox(height: 16),
                    Text(
                      'Sevarath',
                      style: TextStyle(
                        fontSize: 40,
                        fontWeight: FontWeight.w700,
                        color: AppColors.brandGreen,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Your Companion for Every Journey',
                      style: TextStyle(
                        fontSize: 15,
                        color: AppColors.brandGreen.withValues(alpha: 0.75),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
