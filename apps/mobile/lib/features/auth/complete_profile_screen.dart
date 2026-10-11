import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'providers/auth_provider.dart';

/// Shown after a brand-new Google sign-in with no mobile number resolvable from the identity
/// (docs/plan.md §5/10.5) - mobile is mandatory, and no account was created yet; submitting here
/// is what actually creates it.
class CompleteProfileScreen extends ConsumerStatefulWidget {
  const CompleteProfileScreen({
    super.key,
    required this.firebaseIdToken,
    this.suggestedName,
    this.suggestedEmail,
  });

  final String firebaseIdToken;
  final String? suggestedName;
  final String? suggestedEmail;

  @override
  ConsumerState<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends ConsumerState<CompleteProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _mobileController = TextEditingController();
  bool _submitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _mobileController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    final success = await ref
        .read(authControllerProvider.notifier)
        .completeGoogleSignup(
          firebaseIdToken: widget.firebaseIdToken,
          mobile: _mobileController.text.trim(),
        );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (success) {
      context.go('/home');
    } else {
      setState(() => _errorMessage = ref.read(authControllerProvider).errorMessage ?? 'Could not save your mobile number.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Nothing was created yet on the backend (docs/plan.md §5/10.5) - going back just means
      // starting Google sign-in over, not losing an in-progress account.
      canPop: false,
      child: Scaffold(
        appBar: AppBar(title: const Text('Confirm your details')),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('One more step', style: AppTextStyles.headline.copyWith(fontSize: 24)),
                    const SizedBox(height: 6),
                    Text(
                      'A mobile number is required to use SevaRath - we use it to identify your rides.',
                      style: AppTextStyles.secondary,
                    ),
                    if (widget.suggestedName != null || widget.suggestedEmail != null) ...[
                      const SizedBox(height: 16),
                      Text(
                        [
                          if (widget.suggestedName != null) widget.suggestedName,
                          if (widget.suggestedEmail != null) widget.suggestedEmail,
                        ].join(' · '),
                        style: AppTextStyles.bodyStrong,
                      ),
                    ],
                    const SizedBox(height: 24),
                    TextFormField(
                      controller: _mobileController,
                      decoration: const InputDecoration(labelText: 'Mobile number'),
                      keyboardType: TextInputType.phone,
                      autofocus: true,
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) return 'Enter your mobile number';
                        if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(value.trim())) {
                          return 'Enter a valid mobile number, e.g. +911234567890';
                        }
                        return null;
                      },
                    ),
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(_errorMessage!, style: const TextStyle(color: AppColors.error)),
                    ],
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Continue'),
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
