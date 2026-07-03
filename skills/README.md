# Agent skills

Installable [agent skills](https://github.com/vercel-labs/skills) that teach your coding agent (Claude Code, Cursor, Codex…) how to add and configure `@eleven-labs/nest-profiler` in your own NestJS application. Each skill is a self-contained `SKILL.md` with bundled `references/`.

## Install

```bash
# All skills from this repo
npx skills add eleven-labs/nest-profiler

# A single skill (monorepo subpath)
npx skills add https://github.com/eleven-labs/nest-profiler/tree/main/skills/setup-nest-profiler
```

`npx skills` auto-detects your installed agents and drops the skill into the right config directory (project scope by default, `-g` for global). Then just ask your agent, e.g. _"set up nest-profiler in this app"_.

## Available skills

| Skill                                                                 | What it does                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`setup-nest-profiler`](setup-nest-profiler/SKILL.md)                 | Install and configure the core profiler end-to-end: introspect the project, pick an enable strategy (`ConditionalModule` vs the `enabled` flag), detect and wire the collectors that match the stack, capture logs, and verify. |
| [`add-nest-profiler-collector`](add-nest-profiler-collector/SKILL.md) | Add one collector package to an app that already has the core profiler set up, matching the existing enable strategy and placement rules.                                                                                       |

## Evals

Each skill has its own `evals/` folder with manual evaluations — one JSON file per topic (`skill.json` for the workflow, plus one per reference file). They assert the enable strategy, collector choice, placement, and gotchas the skill should drive. See [`setup-nest-profiler/evals`](setup-nest-profiler/evals/README.md) and [`add-nest-profiler-collector/evals`](add-nest-profiler-collector/evals/README.md).

## Notes

- `add-nest-profiler-collector/references/collectors.md` is a copy of the setup skill's matrix so each skill installs standalone — keep the two in sync when a collector's package name, peers, options, or gotchas change.
- These consumer skills live under `skills/` (committed, the source of truth per `.gitignore`), distinct from the maintainer skills installed per-developer under `.agents/skills/`.
