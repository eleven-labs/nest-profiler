---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-commander': minor
'@eleven-labs/nest-profiler-graphql': minor
---

Describe non-HTTP route inputs with their own labels in the Routes panel, instead of borrowing **Query params**.

**Core:** `RouteInputs` gains a `groups?: RouteInputGroup[]` field — a list of `{ label, items }` sections whose items are `{ name, description?, required?, defaultValue? }` — and `RouteEntry` gains an optional `description`. Both new types (`RouteInputGroup`, `RouteInputItem`) are exported. The panel renders each group as its own titled section (documented items as a name/description list, bare names as chips) and the route description above the inputs.

**Commander:** the **Commands** group now lists each command's description (from `@Command({ description })`), its positional **Arguments** (split from `@Command({ arguments })`, documented via `argsDescription`, `<required>` marked) and its **Options** (from `@Option()`, with the description, default value and required marker) — previously only the long `--flag` names, mislabelled as _Query params_. Short-only options such as `-q` are now listed too, with their full flags string as the displayed name.

**GraphQL:** field arguments now render under an **Arguments** label, and a field's schema description is surfaced on the route.

The Commands list no longer prints `exit 0` next to the `OK` status — the status already says it. The exit code remains on the **Command** detail tab.
