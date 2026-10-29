---
name: commit-and-release
description: Prepare and make commits in Margaya only when explicitly asked - conventional commit messages checked by commitlint, scopes used in this repo, husky hooks (biome ci, commitlint), targeted Biome checks, the checks CI runs, and how semantic-release cuts releases. Use when the user asks to commit, write a commit message, open a PR, or asks how releases, versioning or CI work.
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
| docker-build | builds `Dockerfile.margaya` |

Report which of these you ran and which you did not.

## 4. Write the message

`commitlint.config.js` extends `@commitlint/config-conventional`: `type(scope): subject`, lowercase type, subject without a trailing period and not in sentence/Pascal/upper case, header at most 100 characters. Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

Scopes in this repo's history are the app or feature area: `web`, `api`, `db`, `ai`, `site`, `i18n`, `mcp`, `landing`, `task`, `project`, `cycle`, `module`, `page`, `trash`, `e2e`, `permissions`, `libs`, ... Check recent ones with:
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

## 6. How releases happen (do not trigger them)

- `release.config.js` (semantic-release) releases from `main` only. Version bump comes from conventional commits (`conventionalcommits` preset) unless `RELEASE_TYPE` forces `patch`/`minor`/`major`.
- `scripts/release/notes.mjs` groups notes by pull request (Features, Bug Fixes, Performance Improvements, Reverts, Code Refactoring, Documentation); `scripts/release/apply-version.mjs` stamps the version; the release commit is `chore(release): vX.Y.Z [skip ci]` and updates `CHANGELOG.md`, `package.json` and `charts/margaya/Chart.yaml`.
- `.github/workflows/release.yml` is manual (`workflow_dispatch`, with a dry-run input) and builds images and the Helm chart. `nightly.yml`, `docker.yml` and `deploy-site.yml` are manual too; `publish-mcp.yml` runs on a published release.
- `feat` and `fix` commits change the next version, so choose the type honestly.

## Done when

- [ ] The user explicitly asked for this commit (and separately for any push or PR).
- [ ] Only task files are staged; unrelated dirty work is untouched.
- [ ] Targeted Biome check and the relevant tests pass; skipped checks are reported.
- [ ] `pnpm exec commitlint` accepts the message; timestamps are real; hooks ran.
- [ ] `git status` after the commit shows only the user's pre-existing changes.
