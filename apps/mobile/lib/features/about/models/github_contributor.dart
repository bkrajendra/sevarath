/// A real contributor to this repo, from GitHub's public contributors API -
/// never fabricated placeholder names, see github_repository.dart.
class GitHubContributor {
  const GitHubContributor({
    required this.login,
    required this.avatarUrl,
    required this.profileUrl,
    required this.contributions,
  });

  final String login;
  final String avatarUrl;
  final String profileUrl;
  final int contributions;

  factory GitHubContributor.fromJson(Map<String, dynamic> json) {
    return GitHubContributor(
      login: json['login'] as String,
      avatarUrl: json['avatar_url'] as String,
      profileUrl: json['html_url'] as String,
      contributions: json['contributions'] as int,
    );
  }
}
