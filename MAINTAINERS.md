# Maintainers guide

Everything needed to release, automate, and administer this monorepo. Day-to-day
contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md); this file is for
maintainers.

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

CI maps these to workflows: **CI** (`ci.yml`: verify + a Node 22/24 test matrix, with an
aggregate `CI` gate), **Quality** (`quality.yml`: changeset policy + publint + pack + attw),
**CodeQL** (`codeql.yml`, informational), plus **Validate commit messages** and **Semantic PR
title** gates. The branch ruleset (`.github/rulesets.json`) requires `CI`, `Package and docs
quality checks`, `Validate commit messages`, and `Semantic PR title`.

## Releasing

Releases run in **CI** from `main` via `changesets/action` (`release.yml`) — never from a
developer machine. Packages publish to the public **npm** registry via **trusted publishing
(OIDC)**: the workflow authenticates with a short-lived OIDC token (`id-token: write`), so there
is **no `NPM_TOKEN` secret to manage**, and build **provenance** is attached automatically.

> Trusted publishing requires npm CLI ≥ 11.5.1; `release.yml` runs `npm install -g npm@latest`
> before publishing to satisfy this.

### Bootstrap: first manual publish (one-time)

A trusted publisher can only be configured for a package that **already exists** on npm — so the
very first publication of each package must be done manually, then trusted publishing takes over:

1. `npm login` to the `@eleven-labs` org (or set a granular local token).
2. `pnpm release:alpha` — publishes the current `0.5.1-alpha.0` under the `alpha` dist-tag from
   your machine (local publish carries no provenance — that's expected, provenance needs OIDC).
3. On npmjs.com, for **each of the 11 packages**: package **Settings → Trusted Publisher → GitHub
   Actions** → organization `eleven-labs`, repository `nest-profiler`, workflow `release.yml`.
4. From then on, every release is **100 % CI via OIDC** — no token, with provenance.

### Stable (0.x)

1. Merge PRs, each carrying a `pnpm changeset`.
2. The release workflow opens/updates a version PR titled `chore(release): version packages`
   (runs `pnpm version-packages`: guard-major → `changeset version` → fill lockstep changelogs).
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

`pnpm release` resolves the dist-tag from `.changeset/pre.json`, so CI publishes under the
matching tag automatically. Consumers install with `pnpm add @eleven-labs/nest-profiler@alpha`.

Leave prerelease mode before resuming stable releases:

```bash
pnpm changeset:pre:exit
git commit -am "chore: exit prerelease"
git push
```

> `pnpm release:alpha` / `release:beta` / `release:stable` publish from your machine (needs
> `npm login`). This is the path for the **bootstrap publish** above; afterwards prefer CI —
> local publishing skips the CI gates and produces no provenance.

### Versioning policy (`ALLOW_MAJOR_BUMPS`)

While in `0.x`, breaking changes ship as a **minor** with a `BREAKING:` note. `pnpm
changeset:guard-major` (run in CI and in `version-packages`) **fails** on any `major`
changeset unless the `ALLOW_MAJOR_BUMPS` Actions variable is `true`. Set it to `true` only
when intentionally cutting v1.

## Repository automation

### Labels & milestones (declarative, auto-synced)

- Edit `.github/labels.yml` / `.github/milestones.yml`, open a PR. On merge to `main`,
  `repo-config.yml` syncs them (labels via `ghaction-github-labeler`; milestones create-if-missing).
- Manual run: **Actions → Repository config → Run workflow**. Tick **prune-labels** to delete
  labels not declared in `labels.yml` (off by default).

### PR auto-labelling

`pr-labeler.yml` (+ `.github/labeler.yml`) applies `scope:*` and `package:*` labels from the
changed paths. Adding a package only requires a new mapping in `labeler.yml` and a new label
in `labels.yml` — no template edits.

### Dependabot

`dependabot.yml` groups npm + GitHub Actions updates; `dependabot-auto-merge.yml`
auto-approves and squash-merges patch/minor bumps.

## One-time setup (manual)

These rarely change, so they are applied by hand rather than scripted. Run with an admin
`gh` login (`gh auth login`). `OWNER/REPO` = `eleven-labs/nest-profiler`.

```bash
# 1. npm publishing: NO repository secret needed — CI uses trusted publishing (OIDC).
#    One-time, in the npmjs.com UI, for each of the 11 packages (after the bootstrap
#    publish above): Settings -> Trusted Publisher -> GitHub Actions ->
#    org "eleven-labs", repo "nest-profiler", workflow "release.yml".
#    (Requires npm CLI >= 11.5.1, handled by release.yml.)

# 2. Branch protection ruleset (uses the committed definition).
gh api --method POST /repos/OWNER/REPO/rulesets --input .github/rulesets.json
#    To update an existing ruleset, find its id and PUT:
#    gh api /repos/OWNER/REPO/rulesets --jq '.[] | "\(.id)\t\(.name)"'
#    gh api --method PUT /repos/OWNER/REPO/rulesets/<id> --input .github/rulesets.json

# 3. Repo settings: auto-delete merged branches + allow auto-merge.
gh api --method PATCH /repos/OWNER/REPO -F delete_branch_on_merge=true -F allow_auto_merge=true

# 4. Release policy variable (gate major bumps).
gh variable set ALLOW_MAJOR_BUMPS --body false

# 5. CODEOWNERS — already committed as `.github/CODEOWNERS` (`* @fpasquet`); edit as the
#    maintainer set changes.
```

After applying the steps above, trigger **Repository config** once to seed labels and milestones.

## Docs deployment

`docs/` is a standalone Fumadocs (Next.js) app deployed by **Vercel's Git integration** —
there is no workflow in this repo. It releases independently of the packages. Validate
locally with `pnpm docs:build`.
