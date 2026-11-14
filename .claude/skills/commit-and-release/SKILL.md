---
name: commit-and-release
description: Prepare and make commits in Margaya only when explicitly asked - conventional commit messages checked by commitlint, scopes used in this repo, husky hooks (biome ci, commitlint), targeted Biome checks, the checks CI runs, the version format (one SemVer vX.Y.Z for server, images, chart and desktop; separate mcp-vX.Y.Z), how to mark breaking changes for a major version, and how semantic-release cuts releases. Use when the user asks to commit, write a commit message, open a PR, prepare or cut a release, bump a version, or asks how releases, versioning or CI work.
---

# Commit and release

Purpose: turn finished, verified work into clean commits without surprising anyone. Root rules: [AGENTS.md](../../../AGENTS.md).

## Hard rules

- **Never commit, push, tag or open a pull request unless the user explicitly asks** for that step. Asking to commit is not permission to push.
- **Real timestamps only.** Never set `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, never pass `--date`, never rewrite history to change dates, and never provide scripts or steps that do. Decline backdating requests.
- Commits carry the user's own git identity. Do not add AI co-author trailers unless the user asks for them.
- **Preserve unrelated dirty work.** Stage only the files that belong to the task, by path. Never `git add -A`, `git add .`, `git stash`, `git checkout -- <file>`, `git reset --hard` or `git clean` over someone else's changes.
- Do not skip hooks (`--no-verify`) unless the user asks; fix the cause instead.
- Never commit `.env`, `.env.local`, `creds.md` or any credential.

## 1. Check the tree

```sh
git status --short
git diff --stat
```
Separate your files from pre-existing changes (the user's dirty files stay unstaged). If a formatter touched files you did not mean to change, revert only your own accidental edits, never theirs.

## 2. Lint without rewriting the repo

The `lint` scripts (root `turbo lint`, and each package's `biome check --write .`) **write fixes** and can reformat unrelated files. Check only what you changed, read-only:
```sh
pnpm exec biome check apps/web/src/fetchers/trash/task-trash.ts apps/api/src/trash/index.ts
```
Apply fixes to those paths only if needed: `pnpm exec biome check --write <same paths>`, then review the diff. Configuration: `biome.json` (tabs, recommended rules plus extra `style` rules; `.claude`, `dist`, `openapi.json`, `routeTree.gen.ts` and e2e outputs are excluded).

## 3. Run the matching checks

Use the `testing` skill for the focused proof. Before a commit the user asked for, also run whatever CI will run for the touched areas (`.github/workflows/ci.yml`):

| CI job | Command |
| --- | --- |
| lint | `pnpm exec biome ci .` (read-only) |
| i18n | `pnpm i18n:check` |
| openapi | `pnpm openapi:check` |
| typecheck | `pnpm typecheck` |
| unit | `node --test scripts/security/*.test.mjs` (CI first pulls `nginx:1.29.5-alpine` with Docker for it) and `pnpm test` with `NODE_OPTIONS=--no-experimental-webstorage` |
| build | `pnpm build` |
| integration | `pnpm test:integration` (needs Postgres; see `testing`) |
| e2e | `pnpm e2e specs/smoke` (Playwright smoke specs; needs Postgres, MailPit and Edge; see `testing`) |
| docker-build | builds `Dockerfile.margaya` |

Report which of these you ran and which you did not.

## 4. Write the message

`commitlint.config.js` extends `@commitlint/config-conventional`: `type(scope): subject`, lowercase type, subject without a trailing period and not in sentence/Pascal/upper case, header at most 100 characters. Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

Scopes in this repo's history are the app or feature area: `web`, `api`, `db`, `ai`, `site`, `i18n`, `mcp`, `landing`, `task`, `project`, `cycle`, `module`, `page`, `trash`, `e2e`, `permissions`, `libs`, ... Use `desktop` for `apps/desktop` and its release workflow. Check recent ones with:
```sh
git log --format=%s -n 50
```
Examples from history: `feat(ai): add voice mode and documentation-grounded answers to Ask AI`, `test(api): add integration tests for remaining features`. Describe the user-visible change, one logical change per commit; put the reason in the body.

Validate before committing:
```sh
printf 'feat(trash): restore sub-tasks with their parent\n' | pnpm exec commitlint
```

## 5. Commit (only when asked)

```sh
git add <path> <path> ...
git commit -m "type(scope): subject" -m "Why the change was needed."
```
Hooks (`.husky/`): `pre-commit` runs `biome check --staged` on the staged files only; CI still runs `biome ci .` over the whole repo, so run that before a pull request and report unrelated failures rather than reformatting other people's files. `commit-msg` runs commitlint. If a hook fails, fix and create a new commit; do not amend unless asked.

Pull requests (only when asked): the title must also pass commitlint (`.github/workflows/pr-title.yml`), since it can become the commit semantic-release reads.

## 6. Versions and releases (do not trigger them)

### One version, one format

Margaya ships one version for the server, the web app, the Docker images, the Helm chart and the desktop app: plain SemVer `MAJOR.MINOR.PATCH` (`1.0.1`), tagged `vMAJOR.MINOR.PATCH` (`v1.0.1`). No pre-release or build suffix on a release: MSI installers can't carry one, and `desktop-release.yml` rejects any tag that isn't `vX.Y.Z`. `scripts/security/validate-release-version.mjs` checks the format.

| Where the version appears | Who writes it |
| --- | --- |
| Git tag `vX.Y.Z` and the GitHub Release | semantic-release |
| `package.json` `version` | `scripts/release/apply-version.mjs`, run by semantic-release |
| `charts/margaya/Chart.yaml` `version` and `appVersion` | the same script; both always equal the tag |
| `CHANGELOG.md` | `@semantic-release/changelog`, notes from `scripts/release/notes.mjs` |
| Image tags and the version the images report | `release.yml` (`build-images.yml`), from the planned version |
| Desktop installers, `latest.json` | `desktop-release.yml` stamps the tag's version at build time |
| `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml` | Placeholders (`0.1.0`). Leave them alone |

`verify-release-source.mjs` refuses a release whose tag, `package.json` version and both chart versions don't agree.

**Never edit these by hand**: no version bumps in `package.json`, `Chart.yaml` or the desktop files, no hand-written `CHANGELOG.md` sections, and no `v*` tags created locally. A hand edit is either overwritten by the release commit or ships a version that no tag backs (a nightly image reporting an unreleased number).

The one exception is `@margaya/mcp`. It versions on its own: bump `packages/mcp/package.json` in the change that alters the package, and publish it with a matching `mcp-vX.Y.Z` tag. `publish-mcp.yml` runs only for `mcp-v*` tags (or manual dispatch) and refuses a tag that differs from the package version.

### Choosing the bump

The commit types since the last tag decide the next version (`conventionalcommits` preset):

| Commits since the last release | Next version | Example |
| --- | --- | --- |
| Only `docs`, `chore`, `test`, `ci`, `build`, `style`, `refactor` | No release | stays `1.0.0` |
| At least one `fix` or `perf` | Patch | `1.0.0` → `1.0.1` |
| At least one `feat` | Minor | `1.0.1` → `1.1.0` |
| At least one breaking change | Major | `1.1.0` → `2.0.0` |

A **major update** is anything an existing installation or client has to act on. Mark it with `!` after the type and a `BREAKING CHANGE:` footer that says what breaks and how to upgrade, for example:

```text
feat(api)!: require a workspace id on every task search

BREAKING CHANGE: GET /api/search/tasks now needs workspaceId. Callers that
omitted it get 400; pass the workspace id from the URL.
```

It is breaking when it:
- removes or renames a route, a request field or a response field, or changes their meaning (`apps/docs/openapi.json` shows it);
- removes or renames an environment variable or Helm value, or changes a default that changes behaviour;
- needs more than the automatic migration on upgrade: a manual step, downtime, or a migration that isn't additive;
- changes the permission vocabulary or a built-in role so that people lose access;
- removes an MCP tool or changes its input;
- needs a newer desktop app (raise `DESKTOP_MIN_VERSION`), or changes `/api/config` in a way older desktop apps can't read.

Choose the type honestly: `feat` and `fix` change the version, and a breaking change without `!` ships as a minor or patch version that breaks installations.

### Cutting a release (the user does this)

Releases come only from `main`, through `.github/workflows/release.yml` (manual, `workflow_dispatch`):
1. Make sure the commits are pushed and CI is green on `main`.
2. Run **Release** with `release_type: auto` and `dry_run: true`. The run summary shows the planned version and notes.
3. If they're right, run it again with `dry_run: false`. It builds and signs the images and the Helm chart, publishes the release commit `chore(release): vX.Y.Z [skip ci]` (updating `CHANGELOG.md`, `package.json` and `Chart.yaml`), the tag and the GitHub Release, then attaches the SBOMs and checksums.
4. The desktop installers come from `desktop-release.yml`, which attaches them with `latest.json` and rebuilds the Download page. A release published with the default `GITHUB_TOKEN` can't start other workflows, so without a `RELEASE_TOKEN` secret it does not start by itself. Run **Desktop Release** by hand with the new tag (`gh workflow run desktop-release.yml --ref main -f tag=vX.Y.Z`), and check that the GitHub Release lists the installers afterwards.

Use `release_type: patch`, `minor` or `major` only when the commits since the last tag don't describe the release: for example `patch` to ship `1.0.1` after `docs`/`chore` commits only. Never force a lower bump than the commits call for.

### The workflows

- `build-images.yml` and `helm-chart.yml` sign images and the chart keylessly with cosign and attest SLSA provenance (the calling jobs must grant `id-token`, `attestations` and `artifact-metadata: write`). The `assets` job attaches the SBOMs, `image-digests.txt` and `SHA256SUMS-sbom.txt` to the GitHub Release. How users check them: `apps/docs/core/installation/verify-a-release.mdx`.
- `desktop-release.yml` runs when a release is published (`v*` tags, not prereleases) or by manual dispatch with an existing tag. Its signing secrets live in the `desktop-release` environment and are never needed locally; see the `desktop-app` skill. CI's `desktop` job in `ci.yml` runs the launcher typecheck, tests and build plus `cargo test --locked`.
- `nightly.yml`, `docker.yml` and `deploy-site.yml` are manual. `publish-mcp.yml` runs on `mcp-v*` tags.

## Done when

- [ ] The user explicitly asked for this commit (and separately for any push or PR).
- [ ] Only task files are staged; unrelated dirty work is untouched.
- [ ] Targeted Biome check and the relevant tests pass; skipped checks are reported.
- [ ] `pnpm exec commitlint` accepts the message; timestamps are real; hooks ran.
- [ ] `git status` after the commit shows only the user's pre-existing changes.
- [ ] Breaking changes carry `!` and a `BREAKING CHANGE:` footer with upgrade steps, and no version, changelog or tag was edited by hand.
