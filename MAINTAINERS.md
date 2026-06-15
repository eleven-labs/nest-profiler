# Maintainers guide

Everything needed to release, automate, and administer this monorepo. Day-to-day contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md); this file is for maintainers.

## Tooling at a glance

| Concern            | Tool                              | Entry point                                        |
| ------------------ | --------------------------------- | -------------------------------------------------- |
| Task orchestration | Turborepo                         | `turbo.json` (always via root `pnpm` scripts)      |
| Versioning/publish | Changesets                        | `.changeset/config.json`, `scripts/changesets/*`   |
| Git hooks          | Husky + lint-staged + commitlint  | `.husky/`, `*.config.mjs`                          |
| Lint/format/types  | `@repo/*` presets                 | `packages/configs/*`                               |
| Package gates      | publint, `npm pack` dry-run, attw | `pnpm publint` / `pnpm pack:dry-run` / `pnpm attw` |
| Example databases  | Docker Compose (Postgres + Mongo) | `pnpm docker:up` / `docker:down` / `docker:reset`  |
| Docs site          | Fumadocs (Next.js)                | `docs/` — deployed by Vercel's Git integration     |

## Quality gates

Mandatory before delivery (also enforced in CI):

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

When a publishable package's manifest or public exports change, also run the publish gates:

```bash
pnpm publint        # manifest / exports correctness
pnpm pack:dry-run   # what actually ends up in the tarball
pnpm attw           # Are the Types Wrong? — type resolution across module systems
```

CI maps these to workflows: **CI** (`ci.yml`: check + a Node 22/24 test matrix, with an aggregate `CI` gate), **Quality** (`quality.yml`: changeset policy + publint + pack + attw), **CodeQL** (`codeql.yml`, informational), plus **Validate commit messages** and **Semantic PR title** gates. The branch ruleset requires `CI`, `Package and docs quality checks`, `Validate commit messages`, and `Semantic PR title`.

## Releasing

Releases run in **CI** from `main` via `changesets/action` (`release.yml`).

### Stable

1. Merge PRs, each carrying a `pnpm changeset`.
2. The release workflow opens/updates a version PR titled `chore(release): version packages` (runs `pnpm version-packages`: guard-major → `changeset version` → fill lockstep changelogs).
3. Merging that PR publishes every bumped package with the `latest` dist-tag.

The whole suite is a Changesets `fixed` group, so all 11 packages move to the same version.

### Alpha / beta prereleases

Same pipeline, in prerelease mode:

```bash
pnpm changeset:pre:alpha     # or :beta — writes .changeset/pre.json
pnpm changeset               # describe the change(s)
git commit -am "chore: enter alpha prerelease"
git push                     # CI opens the version PR; merging publishes `alpha`/`beta`
```

`pnpm release` resolves the dist-tag from `.changeset/pre.json`, so CI publishes under the matching tag automatically. Consumers install with `pnpm add @eleven-labs/nest-profiler@alpha`.

Leave prerelease mode before resuming stable releases:

```bash
pnpm changeset:pre:exit
git commit -am "chore: exit prerelease"
git push
```

### Versioning policy (`ALLOW_MAJOR_BUMPS`)

Breaking changes ship as a **major** with a `BREAKING:` note. `pnpm changeset:guard-major` (run in CI and in `version-packages`) **fails** on any `major` changeset unless the `ALLOW_MAJOR_BUMPS` Actions variable is `true`, so a major release is always deliberate — never accidental. Set it to `true` only when intentionally cutting a major version.

## Repository automation

### Labels & milestones (declarative, auto-synced)

- Edit `.github/labels.yml` / `.github/milestones.yml`, open a PR. On merge to `main`, `repo-config.yml` syncs them (labels via `ghaction-github-labeler`; milestones create-if-missing).
- Manual run: **Actions → Repository config → Run workflow**. Tick **prune-labels** to delete labels not declared in `labels.yml` (off by default).

### PR auto-labelling

`pr-labeler.yml` (+ `.github/labeler.yml`) applies `scope:*` and `package:*` labels from the changed paths. Adding a package only requires a new mapping in `labeler.yml` and a new label in `labels.yml` — no template edits.

### Dependabot

`dependabot.yml` groups npm + GitHub Actions updates; `dependabot-auto-merge.yml` auto-approves and squash-merges patch/minor bumps.

## Docs deployment

`docs/` is a standalone Fumadocs (Next.js) app deployed by **Vercel's Git integration** — there is no workflow in this repo. It releases independently of the packages. Validate locally with `pnpm docs:build`.
