class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.role,
    required this.userId,
  });

  factory AuthTokens.fromJson(Map<String, dynamic> json) => AuthTokens(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    role: json['role'] as String,
    userId: json['userId'] as String,
  );

  final String accessToken;
  final String refreshToken;
  final String role;
  final String userId;
}
