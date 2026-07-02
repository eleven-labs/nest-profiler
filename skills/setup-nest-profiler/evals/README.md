# Evals

Manual evaluations for the `setup-nest-profiler` skill. One file per topic: `skill.json` covers the top-level workflow (introspection, routing, guards), and each `<reference>.json` maps to the matching `references/<reference>.md`.

## Format

Each eval file is a JSON array:

```json
[
  {
    "query": "User input to test",
    "expected_behavior": "OUTCOME. What the response should do."
  }
]
```

| File                     | Maps to                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `skill.json`             | `../SKILL.md` — introspect-first, setup vs add-collector routing, non-Nest guard, multi-select |
| `enable-strategies.json` | `../references/enable-strategies.md` — Approach A vs B, no-op fallback                         |
| `collectors.json`        | `../references/collectors.md` — detection, placement, per-collector gotchas                    |
| `options.json`           | `../references/options.md` — options, env vars, headers, storage                               |

## Running Evals

In Claude Code:

```
Run the evals in evals/<reference>.json. For each query, spawn a Sonnet agent with the relevant skill context and compare the response against expected_behavior. Feed the whole SKILL.md and the evaluated reference file (its references/<reference>.md) without compression. Report pass/fail for each.
```
