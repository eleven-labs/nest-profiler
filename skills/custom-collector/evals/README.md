# Evals

Manual evaluations for the `custom-collector` skill. `skill.json` covers choosing between a collector (`IProfilerCollector`) and a context adapter (`IContextAdapter`), and the "never invent a package" rule.

## Format

Each eval file is a JSON array of `{ "query", "expected_behavior" }`; `expected_behavior` begins with an OUTCOME.

## Running Evals

In Claude Code:

```
Run the evals in evals/skill.json. For each query, spawn a Sonnet agent with the whole SKILL.md (no compression) and compare the response against expected_behavior. Report pass/fail for each.
```
