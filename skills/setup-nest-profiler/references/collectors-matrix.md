# Collector detection matrix

Map a dependency found in the consumer's `package.json` to the collector package that instruments it, then open the matching **family reference** for its full options, snippet, gotcha and the question(s) to ask. All collectors are published under the `@eleven-labs/` scope, peer on the core `@eleven-labs/nest-profiler`, `@nestjs/common@^11`, `@nestjs/core@^11`, `reflect-metadata@^0.2`, and (most of them) `nestjs-cls@^6`. Only the **distinguishing** signal is listed below.

There is **no stable release yet** — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`<pm> add <package>@alpha`); `@latest` resolves to nothing.

Detection confidence:

- **Hard peer** — the collector declares the host lib as a required peer; presence in the consumer is a reliable signal.
- **Optional peer** — declared via `peerDependenciesMeta`; the module is a safe no-op when the host lib is absent, so it is fine to offer but never force.
- **Heuristic** — no host peer at all; key off a related package the app is likely to use.

## Matrix

| Consumer dependency (signal)                | Confidence                                     | Collector package                      | Family reference            |
| ------------------------------------------- | ---------------------------------------------- | -------------------------------------- | --------------------------- |
| `typeorm` + `@nestjs/typeorm`               | hard                                           | `@eleven-labs/nest-profiler-typeorm`   | `collectors-orm.md`         |
| `@mikro-orm/core` + `@mikro-orm/nestjs`     | hard                                           | `@eleven-labs/nest-profiler-mikro-orm` | `collectors-orm.md`         |
| `mongoose` + `@nestjs/mongoose`             | hard                                           | `@eleven-labs/nest-profiler-mongoose`  | `collectors-orm.md`         |
| `@nestjs/axios` / `axios` (any HTTP client) | optional                                       | `@eleven-labs/nest-profiler-http`      | `collectors-http.md`        |
| `class-validator` / `nestjs-zod`            | heuristic (deliberately not a peer)            | `@eleven-labs/nest-profiler-validator` | `collectors-validator.md`   |
| `@nestjs/config`                            | hard                                           | `@eleven-labs/nest-profiler-config`    | `collectors-config-auth.md` |
| `@nestjs/passport` / `@nestjs/jwt`          | heuristic (dependency-free)                    | `@eleven-labs/nest-profiler-auth`      | `collectors-config-auth.md` |
| `@nestjs/cache-manager`                     | hard                                           | `@eleven-labs/nest-profiler-cache`     | `collectors-simple.md`      |
| `@nestjs/graphql` + `graphql`               | hard (`graphql`), optional (`@nestjs/graphql`) | `@eleven-labs/nest-profiler-graphql`   | `collectors-simple.md`      |
| `nest-commander`                            | optional                                       | `@eleven-labs/nest-profiler-commander` | `collectors-simple.md`      |
| `@golevelup/nestjs-rabbitmq` + `amqplib`    | optional                                       | `@eleven-labs/nest-profiler-rabbitmq`  | `collectors-simple.md`      |
| _(any REST/GraphQL/microservice/CLI app)_   | always available (opt-in panel)                | `@eleven-labs/nest-profiler-routes`    | `collectors-simple.md`      |

## Gating

Every collector is gated the same way as the core module. The per-collector snippets in the family files show **Approach A** — wrap the `forRoot(...)` / `forRootAsync(...)` in `ConditionalModule.registerWhen(..., isProfilerEnabled)`. For **Approach B** (the core `enabled` flag), **drop the `ConditionalModule.registerWhen(...)` wrapper and import the module directly** (`imports: [HttpCollectorModule.forRoot(...)]`) — it is a cheap no-op when the core is inert. Match whichever strategy the core uses; collectors need **no** no-op counterpart: they self-register through discovery and simply do nothing when the active profiler is absent.

## Placement rule

- **Root / global collectors** — `config`, `validator`, `routes`, `commander` contribute global panels (bootstrap snapshot, discovery panels). They belong at the composition root; bundle them with the core into a single `ProfilingModule` (see `enable-strategies.md`) to keep the root tidy. `validator`'s pipe is app-owned in `main.ts` (`createProfilerValidationPipe`), so its panel gates like the others (see `collectors-validator.md`).
- **Infra-scoped collectors** — database (typeorm/mikro-orm/mongoose incl. their Schema companion), `http`, `cache`, `rabbitmq`, and the GraphQL transport stay co-located in the feature module that owns their infrastructure, each with its own gate.

## Asking which to add

Cross-reference `package.json` against the matrix, then **ask the user (multi-select)** which detected collectors to add — do not assume all. Same `AskUserQuestion` rules as the enable strategy: `header` ≤ 12 characters, technical and concrete option descriptions. Then, per chosen collector, ask its family-specific key question(s) before wiring.
