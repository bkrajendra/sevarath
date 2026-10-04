import 'package:flutter/material.dart';

/// The sunburst-only brand mark, cropped from docs/logo.png for compact use
/// (app bars, headers). Use [SevarathWordmark] where the full lockup with
/// the "Sevarath" text is wanted (splash, onboarding).
class SevarathMark extends StatelessWidget {
  const SevarathMark({super.key, this.size = 28});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/sunburst-mark.png',
      width: size,
      height: size,
      fit: BoxFit.contain,
    );
  }
}

class SevarathWordmark extends StatelessWidget {
  const SevarathWordmark({super.key, this.height = 48});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.asset('assets/images/logo.png', height: height, fit: BoxFit.contain);
  }
}
