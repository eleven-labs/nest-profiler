# Evals

Manual evaluations for the `custom-storage-adapter` skill. `skill.json` covers the `IProfilerStorageAdapter` contract (required + optional methods), wiring via the `storage` option, and when a custom adapter is (not) warranted.

## Format

Each eval file is a JSON array of `{ "query", "expected_behavior" }`; `expected_behavior` begins with an OUTCOME.

## Running Evals

In Claude Code:

```
Run the evals in evals/skill.json. For each query, spawn a Sonnet agent with the whole SKILL.md (no compression) and compare the response against expected_behavior. Report pass/fail for each.
```
