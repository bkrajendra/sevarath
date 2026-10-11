import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'data/auth_repository.dart';

/// Two-step flow on one screen (docs/plan.md §5/10.1): request a code, then confirm it with a
/// new password. No deep-linking/App-Links infra needed - the code is just typed in by hand.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

enum _Step { identifier, resetting }

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _repository = AuthRepository(apiClient: ApiClient());
  final _requestFormKey = GlobalKey<FormState>();
  final _confirmFormKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _codeController = TextEditingController();
  final _newPasswordController = TextEditingController();

  _Step _step = _Step.identifier;
  bool _submitting = false;
  String? _errorMessage;
  String? _successMessage;

  @override
  void dispose() {
    _identifierController.dispose();
    _codeController.dispose();
    _newPasswordController.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    if (!_requestFormKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      await _repository.requestPasswordReset(
        identifier: _identifierController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _step = _Step.resetting;
        _successMessage = 'If an account with an email exists, a code was sent.';
      });
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _confirmReset() async {
    if (!_confirmFormKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      await _repository.confirmPasswordReset(
        identifier: _identifierController.text.trim(),
        code: _codeController.text.trim(),
        newPassword: _newPasswordController.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password reset. Please log in.')),
      );
      context.pop();
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: _step == _Step.identifier ? _buildIdentifierStep() : _buildResetStep(),
          ),
        ),
      ),
    );
  }

  Widget _buildIdentifierStep() {
    return Form(
      key: _requestFormKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Forgot your password?', style: AppTextStyles.headline.copyWith(fontSize: 24)),
          const SizedBox(height: 6),
          Text(
            "Enter your mobile number or email and we'll send a reset code if an account with an email exists.",
            style: AppTextStyles.secondary,
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _identifierController,
            decoration: const InputDecoration(labelText: 'Mobile number or email'),
            keyboardType: TextInputType.emailAddress,
            validator: (value) =>
                (value == null || value.trim().isEmpty) ? 'Enter your mobile number or email' : null,
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            Text(_errorMessage!, style: const TextStyle(color: AppColors.error)),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _submitting ? null : _requestCode,
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Send reset code'),
          ),
        ],
      ),
    );
  }

  Widget _buildResetStep() {
    return Form(
      key: _confirmFormKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Enter your code', style: AppTextStyles.headline.copyWith(fontSize: 24)),
          if (_successMessage != null) ...[
            const SizedBox(height: 6),
            Text(_successMessage!, style: AppTextStyles.secondary),
          ],
          const SizedBox(height: 24),
          TextFormField(
            controller: _codeController,
            decoration: const InputDecoration(labelText: '6-digit code'),
            keyboardType: TextInputType.number,
            maxLength: 6,
            validator: (value) =>
                (value == null || value.trim().length != 6) ? 'Enter the 6-digit code' : null,
          ),
          TextFormField(
            controller: _newPasswordController,
            decoration: const InputDecoration(labelText: 'New password'),
            obscureText: true,
            validator: (value) =>
                (value == null || value.length < 8) ? 'Password must be at least 8 characters' : null,
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            Text(_errorMessage!, style: const TextStyle(color: AppColors.error)),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _submitting ? null : _confirmReset,
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Reset password'),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: _submitting ? null : () => setState(() => _step = _Step.identifier),
            child: const Text('Use a different mobile number or email'),
          ),
        ],
      ),
    );
  }
}
