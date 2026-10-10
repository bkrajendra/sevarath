import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/about/models/github_contributor.dart';

void main() {
  group('GitHubContributor.fromJson', () {
    test('parses a real GitHub contributors-API entry', () {
      final contributor = GitHubContributor.fromJson({
        'login': 'bkrajendra',
        'id': 994083,
        'avatar_url': 'https://avatars.githubusercontent.com/u/994083?v=4',
        'html_url': 'https://github.com/bkrajendra',
        'contributions': 68,
      });

      expect(contributor.login, 'bkrajendra');
      expect(contributor.avatarUrl, 'https://avatars.githubusercontent.com/u/994083?v=4');
      expect(contributor.profileUrl, 'https://github.com/bkrajendra');
      expect(contributor.contributions, 68);
    });
  });
}
