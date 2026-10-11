/// Google Sign-In configuration (Phase 10.5, docs/plan.md §5).
class GoogleAuthConfig {
  GoogleAuthConfig._();

  /// The Firebase project's auto-created "Web client" OAuth client id (client_type 3 in
  /// google-services.json) - both Android flavors share the same one (confirmed by reading
  /// android/app/google-services.json directly). Required as `serverClientId` so the Google ID
  /// token google_sign_in returns has an audience Firebase Auth recognizes; without it,
  /// `GoogleAuthProvider.credential` would be rejected server-side by Firebase.
  static const String webClientId =
      '1010698548403-59f6f2psc8l2vj6d1pbf8ha4u56j8to7.apps.googleusercontent.com';
}
