import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../../shared/widgets/sevarath_mark.dart';
import 'data/github_repository.dart';
import 'models/github_contributor.dart';

final githubRepositoryProvider = Provider<GitHubRepository>((ref) => GitHubRepository());

final packageInfoProvider = FutureProvider<PackageInfo>((ref) => PackageInfo.fromPlatform());

final contributorsProvider = FutureProvider<List<GitHubContributor>>((ref) {
  return ref.read(githubRepositoryProvider).getContributors();
});

Future<void> _openUrl(String url) async {
  final uri = Uri.parse(url);
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// About SevaRath - real app version (package_info_plus, not a hardcoded string that would go
/// stale) and a real contributor list pulled live from the public GitHub repo
/// (github_repository.dart) - never a mock/placeholder roster. Design follows docs/about-page.png,
/// recolored to the app's own theme (app_colors.dart) rather than the mock's own palette.
class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contributorsAsync = ref.watch(contributorsProvider);
    final packageInfoAsync = ref.watch(packageInfoProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('About SevaRath')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _AppHeader(packageInfoAsync: packageInfoAsync),
          const SizedBox(height: 28),
          Text('Souls behind seva', style: AppTextStyles.headline.copyWith(fontSize: 22)),
          const SizedBox(height: 4),
          Text('The people who make every journey possible.', style: AppTextStyles.secondary),
          const SizedBox(height: 16),
          _ContributorsSummaryCard(contributorsAsync: contributorsAsync),
          const SizedBox(height: 28),
          Text('Our Contributors', style: AppTextStyles.headline.copyWith(fontSize: 20)),
          const SizedBox(height: 12),
          contributorsAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, stackTrace) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(
                children: [
                  Text('Could not load contributors', style: AppTextStyles.secondary),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => ref.invalidate(contributorsProvider),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
            data: (contributors) => Column(
              children: [
                for (final contributor in contributors) ...[
                  _ContributorTile(contributor: contributor),
                  const SizedBox(height: 10),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
          const _ThankYouCard(),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brandGreen,
                foregroundColor: AppColors.textOnBrand,
                minimumSize: const Size(0, 52),
              ),
              onPressed: () => _openUrl(sevarathRepoUrl),
              icon: const Icon(Icons.code_rounded),
              label: const Text('View on GitHub'),
            ),
          ),
        ],
      ),
    );
  }
}

class _AppHeader extends StatelessWidget {
  const _AppHeader({required this.packageInfoAsync});

  final AsyncValue<PackageInfo> packageInfoAsync;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 88,
          height: 88,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surfaceTint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: const SevarathMark(size: 60),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('SevaRath', style: AppTextStyles.headline.copyWith(fontSize: 26)),
              const SizedBox(height: 4),
              packageInfoAsync.when(
                loading: () => Text('Version …', style: AppTextStyles.secondary),
                error: (error, stackTrace) => Text('Version unavailable', style: AppTextStyles.secondary),
                data: (info) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Version ${info.version}', style: AppTextStyles.secondary),
                    Text('Build ${info.buildNumber}', style: AppTextStyles.secondary),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ContributorsSummaryCard extends StatelessWidget {
  const _ContributorsSummaryCard({required this.contributorsAsync});

  final AsyncValue<List<GitHubContributor>> contributorsAsync;

  @override
  Widget build(BuildContext context) {
    final contributors = contributorsAsync.value ?? const [];
    const maxAvatarsShown = 5;
    final shown = contributors.take(maxAvatarsShown).toList();
    final overflow = contributors.length - shown.length;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceTint,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          SizedBox(
            width: shown.isEmpty ? 0 : 36.0 + (shown.length - 1) * 24 + (overflow > 0 ? 24 : 0),
            height: 36,
            child: Stack(
              children: [
                for (var i = 0; i < shown.length; i++)
                  Positioned(
                    left: i * 24.0,
                    child: _AvatarBubble(contributor: shown[i]),
                  ),
                if (overflow > 0)
                  Positioned(
                    left: shown.length * 24.0,
                    child: Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.surfaceTint, width: 2),
                      ),
                      child: Text('+$overflow', style: AppTextStyles.caption),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Built through kindness and shared effort.', style: AppTextStyles.bodyStrong),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.groups_rounded, size: 16, color: AppColors.brandGreen),
                    const SizedBox(width: 6),
                    Text(
                      contributorsAsync.when(
                        data: (c) => '${c.length} ${c.length == 1 ? 'contributor' : 'contributors'}',
                        loading: () => 'Loading…',
                        error: (error, stackTrace) => 'Unavailable',
                      ),
                      style: AppTextStyles.secondary,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AvatarBubble extends StatelessWidget {
  const _AvatarBubble({required this.contributor});

  final GitHubContributor contributor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.surfaceTint, width: 2),
      ),
      child: ClipOval(
        child: Image.network(
          contributor.avatarUrl,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => _InitialAvatar(login: contributor.login),
        ),
      ),
    );
  }
}

class _InitialAvatar extends StatelessWidget {
  const _InitialAvatar({required this.login});

  final String login;

  @override
  Widget build(BuildContext context) {
    final color = AppColors.categoryBadges[login.hashCode.abs() % AppColors.categoryBadges.length];
    return Container(
      color: color.withValues(alpha: 0.15),
      alignment: Alignment.center,
      child: Text(
        login.isNotEmpty ? login[0].toUpperCase() : '?',
        style: AppTextStyles.bodyStrong.copyWith(color: color),
      ),
    );
  }
}

class _ContributorTile extends StatelessWidget {
  const _ContributorTile({required this.contributor});

  final GitHubContributor contributor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            height: 44,
            child: ClipOval(
              child: Image.network(
                contributor.avatarUrl,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => _InitialAvatar(login: contributor.login),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(contributor.login, style: AppTextStyles.bodyStrong),
                Text(
                  '${contributor.contributions} ${contributor.contributions == 1 ? 'commit' : 'commits'}',
                  style: AppTextStyles.secondary,
                ),
              ],
            ),
          ),
          Material(
            color: AppColors.surfaceTint,
            borderRadius: BorderRadius.circular(10),
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => _openUrl(contributor.profileUrl),
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Icon(Icons.code_rounded, color: AppColors.brandGreen, size: 20),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ThankYouCard extends StatelessWidget {
  const _ThankYouCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceTint,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          const SevarathMark(size: 40),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Made with care. Offered in service.', style: AppTextStyles.bodyStrong),
                const SizedBox(height: 4),
                Text(
                  'Heartfelt thanks to everyone who contributes to SevaRath.',
                  style: AppTextStyles.secondary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
