# Evals

Manual evaluations for the `interpret-performance-tags` skill. `skill.json` covers reading the built-in tags (slow / n+1 / chatty / large-payload / error), tuning per-collector thresholds, and adding a custom `PerformanceRule`.

## Format

Each eval file is a JSON array of `{ "query", "expected_behavior" }`; `expected_behavior` begins with an OUTCOME.

## Running Evals

In Claude Code:

```
Run the evals in evals/skill.json. For each query, spawn a Sonnet agent with the whole SKILL.md (no compression) and compare the response against expected_behavior. Report pass/fail for each.
```
