class UserProfile {
  const UserProfile({
    required this.id,
    required this.name,
    required this.mobile,
    this.email,
    required this.role,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
    id: json['id'] as String,
    name: json['name'] as String,
    mobile: json['mobile'] as String,
    email: json['email'] as String?,
    role: json['role'] as String,
  );

  final String id;
  final String name;
  final String mobile;
  final String? email;
  final String role;
}
