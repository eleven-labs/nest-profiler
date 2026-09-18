# Maintainers guide

Everything needed to release, automate, and administer this monorepo. Day-to-day contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md); this file is for maintainers.

## Tooling at a glance

| Concern            | Tool                                         | Entry point                                        |
| ------------------ | -------------------------------------------- | -------------------------------------------------- |
| Task orchestration | Turborepo                                    | `turbo.json` (always via root `pnpm` scripts)      |
| Versioning/publish | Changesets                                   | `.changeset/config.json`, `scripts/changesets/*`   |
| Git hooks          | Husky + lint-staged + commitlint             | `.husky/`, `*.config.mjs`                          |
| Lint/format/types  | `@repo/*` presets                            | `packages/configs/*`                               |
| Package gates      | publint, `npm pack` dry-run, attw            | `pnpm publint` / `pnpm pack:dry-run` / `pnpm attw` |
| Example databases  | Docker Compose (Postgres + Mongo + RabbitMQ) | `pnpm docker:up` / `docker:down` / `docker:reset`  |
| Docs site          | Fumadocs (Next.js)                           | `docs/` — deployed by Vercel's Git integration     |

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

CI maps these to workflows: **CI** (`ci.yml`: check + a Node 22/24 test matrix, with an aggregate `CI` gate), **Quality** (`quality.yml`: publint + pack + attw + documented public exports, plus a skill-references sync job), **CodeQL** (`codeql.yml`, informational), plus **Validate commit messages** and **Semantic PR title** gates. The branch ruleset requires `CI`, `Package and docs quality checks`, `Validate commit messages`, and `Semantic PR title`.

## Releasing

Releases run in **CI** from `main` via `changesets/action` (`release.yml`).

### Stable

1. Merge PRs, each carrying a `pnpm changeset`.
2. The release workflow opens/updates a version PR titled `chore(release): version packages` (runs `pnpm version-packages`, i.e. `changeset version`).
3. Merging that PR publishes every bumped package with the `latest` dist-tag.

The suite is a Changesets `linked` group: **only the packages that actually changed are released**, and those released in the same run share one version. A package with no changeset keeps the version it had — no empty `No changes in this release` entry, no pointless publish.

The group still guarantees alignment where it matters. Every collector peer-depends on the core with a caret range, so a core `major` takes the whole suite out of range: the 13 collectors are released alongside it, land on the same new major, and get their peer rewritten. A core `patch` or `minor` stays in range and releases the core alone.

### Alpha / beta prereleases

Same pipeline, in prerelease mode:

```bash
pnpm changeset:pre:alpha     # or :beta — writes .changeset/pre.json
pnpm changeset               # describe the change(s)
git commit -am "chore: enter alpha prerelease"
git push                     # CI opens the version PR; merging publishes `alpha`/`beta`
```

`pnpm release` resolves the dist-tag from `.changeset/pre.json`, so CI publishes under the matching tag automatically. Consumers install with `pnpm add @eleven-labs/nest-profiler@alpha`.

Each prerelease version moves the changesets it consumed into `.changeset/pre/`, where they wait for the stable release — they are not lost, and the version PR is expected to carry them.

Now that `1.0.0` is out, `latest` always points at the newest stable version: npm only moves `alpha`/`beta` for a prerelease publish and leaves `latest` alone, so a bare `npm install @eleven-labs/nest-profiler` keeps resolving to the stable line.

### Leaving prerelease mode

Leave prerelease mode before resuming stable releases. This is a rare, one-off step done manually from `main` by a maintainer:

```bash
pnpm changeset:pre:exit                  # flips .changeset/pre.json to "mode": "exit"
git commit -am "chore: exit prerelease mode"
git push                                  # CI's Release workflow then cuts the stable version PR
```

`changeset pre exit` does not delete `.changeset/pre.json`; it sets `"mode": "exit"`. The next `changeset version` (run by the Release workflow once the commit lands on `main`) produces stable versions from every changeset accumulated in `.changeset/pre/`, then removes both that folder and `pre.json`. Review that batch before merging the version PR: it is the changelog of the whole prerelease series.

### Packages pinned to their own dist-tag

A package whose manifest declares a non-`latest` `publishConfig.tag` is pinned to that channel and stays there, release after release, while the rest of the suite ships stable. Today that is `@eleven-labs/nest-profiler-ai`, pinned to `alpha`.

Such a package goes through the ordinary flow — `pnpm changeset` lists it, it gets a changelog, a git tag and a GitHub release — with two channel-specific steps:

- `pnpm version-packages` (`scripts/changesets/version.ts`) runs `changeset version`, then puts the pinned package back on its prerelease line. Changesets, whose prerelease mode is repo-wide and off here, would version `1.0.0-alpha.0` plus a `minor` as a stable `1.0.0`; the script rewrites that to `1.0.0-alpha.1`, in the manifest and in the changelog entry. A bump that reaches a new base version starts that base's own series, e.g. `2.0.0-alpha.0`.
- `pnpm release` (`scripts/changesets/publish.ts`) publishes it first, under its own dist-tag, then lets `changeset publish` ship the rest under the release channel's tag. `changeset publish` applies one dist-tag to the whole run, so an alpha caught in a stable release would otherwise land on `latest` and take over the stable line. The script tags the release and reports it through `CHANGESETS_OUTPUT`, the NDJSON stream `changesets/action` reads to push git tags and cut GitHub releases — a prerelease version is flagged as a pre-release there.

A pinned package is deliberately outside the `linked` group: it keeps its own version line and is never dragged along by a suite-wide release. Graduating it is a one-off manual step — drop `publishConfig.tag`, set the stable version by hand, and add it to `linked` if it should follow the suite from then on.

### Versioning policy

Breaking changes ship as a **major** with a `BREAKING:` note in the changeset body. In alpha/beta (prerelease) mode a major never moves the base version — every run only bumps the `-alpha.N` / `-beta.N` counter — so breaking changes flow freely; the major only materializes when you leave prerelease mode and cut the stable version. Review the `chore(release): version packages` PR before merging it: that diff is the deliberate gate on what actually ships.

**A core major needs a changeset per collector.** Write them in the same PR, one `major` changeset each, saying what the collector now requires. Left to itself Changesets still lands every collector on the new major — the `linked` group and the out-of-range peer see to that — but it titles the section from the _reason_ it bumped them, a dependency update, so the entry reads `### Patch Changes` / `Updated dependencies` under a `## 2.0.0` heading. The version is right, the note says nothing, and the heading contradicts it. A peer requirement moving to a new major is a breaking change for consumers and deserves to be written as one.

## Repository automation

### Labels (declarative, auto-synced)

- Edit `.github/labels.yml`, open a PR. On merge to `main`, `repo-config.yml` syncs them via `ghaction-github-labeler`.
- Manual run: **Actions → Repository config → Run workflow**. Tick **prune-labels** to delete labels not declared in `labels.yml` (off by default).
- Milestones are created and closed by hand in the GitHub UI — a declarative sync could only ever re-create the ones a maintainer had just deleted.

### PR auto-labelling

`pr-labeler.yml` (+ `.github/labeler.yml`) applies `scope:*` and `package:*` labels from the changed paths. Adding a package only requires a new mapping in `labeler.yml` and a new label in `labels.yml` — no template edits.

### Dependabot

`dependabot.yml` groups npm + GitHub Actions updates; `dependabot-auto-merge.yml` auto-approves and squash-merges patch/minor bumps.

## Docs deployment

`docs/` is a standalone Fumadocs (Next.js) app deployed by **Vercel's Git integration** — there is no workflow in this repo. It releases independently of the packages. Validate locally with `pnpm docs:build`.
