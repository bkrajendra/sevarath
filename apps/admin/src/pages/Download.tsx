import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  LoaderCircle,
  PackageCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';

interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  assets: GitHubAsset[];
}

const RELEASES_URL = 'https://api.github.com/repos/bkrajendra/sevarath/releases?per_page=100';

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReleaseDate(date: string | null) {
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(date),
  );
}

export function DownloadPage() {
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReleases() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(RELEASES_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`GitHub returned ${response.status}. Please try again shortly.`);
        }
        const data: GitHubRelease[] = await response.json();
        setReleases(
          data.filter((release) =>
            release.assets.some((asset) => asset.name.toLowerCase().endsWith('.apk')),
          ),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not load releases. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadReleases();
    return () => controller.abort();
  }, []);

  const latestRelease = releases[0];

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#f8f7f2] text-[#10231a]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-56 left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-emerald-100/20 blur-[140px]" />
        <div className="absolute right-[-12rem] top-[34rem] h-[24rem] w-[24rem] rounded-full bg-orange-100/20 blur-[110px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2549380b_1px,transparent_1px)] [background-size:28px_28px]" />
      </div>

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <a href="/download" className="flex items-center gap-3" aria-label="SevaRath download home">
          <img
            src="/sevarath-logo.png"
            alt=""
            className="h-24 w-auto object-contain"
          />
        </a>
        <a
          href="https://github.com/bkrajendra/sevarath/releases"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-[#d9e2d9] bg-white/70 px-4 py-2 text-sm text-[#43564b] transition hover:border-[#087a43]/40 hover:text-[#075b36]"
        >
          <PackageCheck size={16} />
          <span className="hidden sm:inline">All releases</span>
          <ArrowUpRight size={14} />
        </a>
      </header>

      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-10 sm:px-8 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:pb-24">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#087a43]/15 bg-[#e8f2eb] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#087a43]">
            <Sparkles size={14} className="text-[#ed7625]" />
            THE SEVARATH ANDROID APP
          </div>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] tracking-[-0.04em] sm:text-6xl">
            A smoother ride,
            <span className="block text-[#087a43]">
              one tap away.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#5c6c62] sm:text-lg sm:leading-8">
            Get the SevaRath Android app. Choose the latest build or download an APK from any published release,
            including prereleases.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#53675a]">
            <span className="inline-flex items-center gap-2">
              <PackageCheck size={17} className="text-[#087a43]" />
              Official GitHub builds
            </span>
            <span className="inline-flex items-center gap-2">
              <ArrowDownToLine size={17} className="text-[#ed7625]" />
              Android APK
            </span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-emerald-200/50 via-orange-100/50 to-transparent blur-2xl" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-[#e6e4dc] bg-white/95 p-6 shadow-xl shadow-[#354539]/10 sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-wide text-[#718077]">LATEST ANDROID BUILD</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {latestRelease?.name || latestRelease?.tag_name || 'Ready when you are'}
                </h2>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f2eb] text-[#087a43]">
                <Smartphone size={22} />
              </span>
            </div>

            {loading ? (
              <div className="flex min-h-28 items-center justify-center gap-3 text-sm text-[#718077]">
                <LoaderCircle size={18} className="animate-spin text-[#087a43]" />
                Checking for the latest APK…
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm text-rose-800">{error}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-3 text-sm font-medium text-rose-900 underline decoration-rose-300 underline-offset-4 hover:decoration-rose-700"
                >
                  Reload page
                </button>
              </div>
            ) : latestRelease ? (
              <>
                <p className="mb-5 flex flex-wrap items-center gap-2 text-sm text-[#718077]">
                  <span>{latestRelease.tag_name}</span>
                  <span className="text-[#c1c9c1]">·</span>
                  <span>{formatReleaseDate(latestRelease.published_at)}</span>
                  {latestRelease.prerelease && (
                    <span className="rounded-full border border-[#ed7625]/20 bg-[#fff2e8] px-2 py-0.5 text-xs font-medium text-[#a74d0d]">
                      Prerelease
                    </span>
                  )}
                </p>
                <div className="flex flex-col gap-3">
                  {latestRelease.assets.map((asset) => (
                    <a
                      key={asset.id}
                      href={asset.browser_download_url}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#087a43] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#066637] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087a43] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      <ArrowDownToLine size={18} />
                      {asset.browser_download_url.includes("Driver") ? "SevaRath Driver": "SevaRath Riders"}
                      <span className="font-normal text-white/75">· {formatFileSize(asset.size)}</span>
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-[#e6e4dc] bg-[#fbfaf7] p-4 text-sm leading-6 text-[#65746b]">
                No published APKs yet. Check back after the first app release.
              </div>
            )}
            <p className="mt-4 text-center text-xs leading-5 text-[#879189]">
              Downloading means you’re getting the APK directly from GitHub.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#dfe4dc] pb-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-[#ed7625]">BUILD ARCHIVE</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">More versions</h2>
          </div>
          {!loading && !error && (
            <span className="text-sm text-[#718077]">
              {releases.length} {releases.length === 1 ? 'build' : 'builds'} available
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-[#718077]">
            <LoaderCircle size={18} className="animate-spin text-[#087a43]" />
            Loading releases…
          </div>
        ) : error ? (
          <p className="py-8 text-sm text-[#718077]">Release history is temporarily unavailable.</p>
        ) : releases.length === 0 ? (
          <p className="py-8 text-sm text-[#718077]">Published APK versions will appear here.</p>
        ) : (
          <div className="divide-y divide-[#e5e7e1]">
            {releases.map((release) => (
              <article
                key={release.id}
                className="flex flex-col gap-5 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-[#10231a]">{release.name || release.tag_name}</h3>
                    {release.prerelease ? (
                      <span className="rounded-full border border-[#ed7625]/20 bg-[#fff2e8] px-2 py-0.5 text-[11px] font-medium text-[#a74d0d]">
                        Prerelease
                      </span>
                    ) : (
                      <span className="rounded-full border border-[#087a43]/15 bg-[#e8f2eb] px-2 py-0.5 text-[11px] font-medium text-[#087a43]">
                        Stable
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-[#718077]">
                    {release.tag_name} <span className="px-1 text-[#c1c9c1]">·</span>{' '}
                    {formatReleaseDate(release.published_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {release.assets.map((asset) => (
                    <a
                      key={asset.id}
                      href={asset.browser_download_url}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#dfe4dc] bg-white px-3.5 py-2 text-sm font-medium text-[#33483a] transition hover:border-[#087a43]/40 hover:bg-[#edf5ef] hover:text-[#075b36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087a43]"
                    >
                      <ArrowDownToLine size={15} />
                      {asset.browser_download_url.includes("Driver") ? "SevaRath Driver" : "SevaRath Riders"}
                      <span className="text-xs text-[#879189]">{formatFileSize(asset.size)}</span>
                    </a>
                  ))}
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${release.tag_name} on GitHub`}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm text-[#718077] transition hover:bg-[#edf5ef] hover:text-[#075b36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087a43]"
                  >
                    Release notes
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-[#dfe4dc]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-6 text-xs text-[#879189] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© SevaRath</span>
          <a
            href="https://github.com/bkrajendra/sevarath/releases"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-[#075b36]"
          >
            Releases hosted on GitHub <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </main>
  );
}
