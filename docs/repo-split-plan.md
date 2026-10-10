# Repo Split Plan: Extract `apps/mobile` into its own repository

> Back to [README](../README.md) · See also [Implementation Plan](./plan.md) · [Open Items](./open-items.md)

**Status: deferred, not started.** Decided (2026-10-10) to finish the pending mobile app implementation work in this monorepo first, then revisit this split. Saved here so the reasoning and concrete steps aren't lost in the meantime.

## Context

`sevarath` currently holds three apps in one monorepo: `apps/api` (NestJS), `apps/admin` (React), `apps/mobile` (Flutter, rider+driver flavors). The question was whether mobile and api+admin should live in separate repos for better version management. Stated pain points: build-tool separation, upcoming iOS builds/certificates/signing becoming "too much" to mix in with the backend repo, versioning/release clarity, CI cost, and eventual team/access separation (solo today, but planning ahead) - preparing for real app-store releases.

An investigation of the actual repo (2026-10-10) confirmed this split would be low-friction and well-aligned with how the project already works:

- **`ci.yml` has no path filtering** - every push to `main` runs all three jobs (api/admin/mobile) regardless of what changed. A backend-only commit currently spins up Flutter CI for nothing, and vice versa.
- **Mobile is already architecturally isolated**: it's not part of the pnpm workspace (`apps/mobile` has no `package.json`; `packages: ['apps/*']` simply skips it), it has its own CI job, and it already has a fully separate, manually-triggered release pipeline (`mobile-release.yml`, `workflow_dispatch` only, publishes a GitHub Release APK). Splitting it out would be "move + rewire CI," not an untangling project.
- **`apps/api` and `apps/admin` are genuinely coupled** at the workspace/build level (shared pnpm workspace + lockfile; each `Dockerfile` needs both apps' `package.json` present to resolve the workspace) and deploy to the same cluster/namespace. `admin` generates its typed API client by hitting a *running* api's OpenAPI JSON (`openapi-typescript http://localhost:3000/api-docs-json`), which is an HTTP step, not a hard source-level dependency - but still benefits from same-repo convenience. No pain point was raised for these two, so the recommendation is they stay together.
- **No versioning/release process exists today for any app**: `package.json`/`pubspec.yaml` versions aren't wired to any tag/release automation; the two existing git tags (`v0.0.1`, `v1.0.0`) are coincidental CI-fix markers, not real releases; k8s deploys `:latest`-tagged images, not pinned versions. Splitting repos doesn't automatically fix this - a release/tagging discipline still needs to be adopted - but a dedicated mobile repo would give its own tag namespace (`vX.Y.Z` = real mobile app versions) a clean start, with zero backend commit noise in between.

**Recommendation when this is revisited: split `apps/mobile` into a new repo (e.g. `sevarath-mobile`). Keep `apps/api` + `apps/admin` together in `sevarath`.** This directly addresses every pain point raised (iOS signing secrets get their own isolated scope, CI stops cross-triggering by construction, mobile gets real independent version tags, and the repo boundary is ready for a separate contributor later) without the cost of untangling api/admin's real workspace coupling, which nobody has asked to undo.

## Migration Steps (when ready)

1. **Extract `apps/mobile`'s history** into a standalone repo, with files moved to the new repo's root (not left under an `apps/mobile/` prefix). Preferred tool: `git filter-repo` (not installed as of this writing - `pip install git-filter-repo`, Python 3.13 is already available in this environment); fallback if that's unavailable: `git subtree split --prefix=apps/mobile -b mobile-split` on a throwaway clone (ships with git, no install, slightly slower/less clean history).
   - Run this against a **fresh clone** of `sevarath`, never the working repo, so a mistake can't touch real history.
2. **Create the new GitHub repo** (e.g. `gh repo create bkrajendra/sevarath-mobile --private` - confirm name/visibility first) and push the extracted history as `main`.
3. **Move mobile's CI/release workflows** into the new repo, rewritten for root-relative paths (today's `ci.yml` mobile job and all of `mobile-release.yml`, with `cd apps/mobile`-style steps removed since mobile *is* the repo root now).
4. **Re-create GitHub Actions secrets** in the new repo's own settings - these do not transfer automatically: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` today; iOS signing secrets (distribution certificate, provisioning profile, App Store Connect API key) go here too once that's set up - isolated from `sevarath`'s own secret scope, which was the original motivating concern. Secret *values* should be entered by the project owner directly (`gh secret set` run by hand), not pasted through an agent.
5. **Verify the new repo stands alone**: fresh clone, `flutter pub get && flutter analyze && flutter test` all pass with no monorepo-relative paths left anywhere; push a trivial commit and confirm its own `ci.yml` goes green; run `mobile-release.yml` once (manual dispatch) and confirm it still produces a working signed APK release.
6. **Only after step 5 is confirmed green**, remove `apps/mobile` from `sevarath`: delete the directory, remove the `mobile` job from `ci.yml`, delete `mobile-release.yml`, update root `README.md` and any `docs/` cross-links to point at the new repo's URL.
7. **Docs stay put**: `docs/` (architecture.md, specification.md, plan.md, open-items.md) remains the system-level source of truth in `sevarath`, since the API contract and overall product plan genuinely span both repos. Add a short pointer in the new mobile repo's README linking back to `sevarath/docs` rather than duplicating content.
8. **Confirm `sevarath`'s own CI is still green** after mobile's removal (api+admin jobs only now).

## Explicitly out of scope for this change

- Splitting `apps/api` and `apps/admin` apart - not requested, and they're genuinely coupled (shared workspace/lockfile, shared Docker build context, same deploy target).
- Building out a real semver/release-tagging process for `sevarath` (api+admin) itself - worth doing eventually (today's `:latest`-only deploys have no version pinning), but that's a separate decision from this repo split and shouldn't block it.
- Setting up actual iOS signing/certificates - out of scope today (mentioned as a future driver for isolating secrets, not something to configure now).
