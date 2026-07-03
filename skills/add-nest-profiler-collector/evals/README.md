# Evals

Manual evaluations for the `add-nest-profiler-collector` skill. `skill.json` covers the add-collector workflow (confirm the base setup, match the existing enable strategy, redirect when the core is missing, never invent a package); `collectors.json` maps to `references/collectors.md` (placement and per-collector gotchas).

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

| File              | Maps to                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `skill.json`      | `../SKILL.md` — base-setup check, strategy matching, routing to setup, no invented packages |
| `collectors.json` | `../references/collectors.md` — placement and per-collector gotchas                         |

## Running Evals

In Claude Code:

```
Run the evals in evals/<reference>.json. For each query, spawn a Sonnet agent with the relevant skill context and compare the response against expected_behavior. Feed the whole SKILL.md and the evaluated reference file (its references/<reference>.md) without compression. Report pass/fail for each.
```
