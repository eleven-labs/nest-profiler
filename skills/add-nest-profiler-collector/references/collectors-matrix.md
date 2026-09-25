# Collector detection matrix

Map a dependency found in the consumer's `package.json` to the collector package that instruments it, then open the matching **family reference** for its full options, snippet, gotcha and the question(s) to ask. All collectors are published under the `@eleven-labs/` scope, peer on the core `@eleven-labs/nest-profiler`, `@nestjs/common@^11`, `@nestjs/core@^11`, `reflect-metadata@^0.2`, and (most of them) `nestjs-cls@^6`. Only the **distinguishing** signal is listed below.

Detection confidence:

- **Hard peer** — the collector declares the host lib as a required peer; presence in the consumer is a reliable signal.
- **Optional peer** — declared via `peerDependenciesMeta`; the module is a safe no-op when the host lib is absent, so it is fine to offer but never force.
- **Heuristic** — no host peer at all; key off a related package the app is likely to use.

## Matrix

| Consumer dependency (signal)                | Confidence                                     | Collector package                          | Family reference            |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------ | --------------------------- |
| `typeorm` + `@nestjs/typeorm`               | hard                                           | `@eleven-labs/nest-profiler-typeorm`       | `collectors-orm.md`         |
| `@mikro-orm/core` + `@mikro-orm/nestjs`     | hard                                           | `@eleven-labs/nest-profiler-mikro-orm`     | `collectors-orm.md`         |
| `mongoose` + `@nestjs/mongoose`             | hard                                           | `@eleven-labs/nest-profiler-mongoose`      | `collectors-orm.md`         |
| `@nestjs/axios` / `axios` (any HTTP client) | optional                                       | `@eleven-labs/nest-profiler-http`          | `collectors-http.md`        |
| `class-validator` / `nestjs-zod`            | heuristic (deliberately not a peer)            | `@eleven-labs/nest-profiler-validator`     | `collectors-validator.md`   |
| `@nestjs/config`                            | hard                                           | `@eleven-labs/nest-profiler-config`        | `collectors-config-auth.md` |
| `@nestjs/passport` / `@nestjs/jwt`          | heuristic (dependency-free)                    | `@eleven-labs/nest-profiler-auth`          | `collectors-config-auth.md` |
| `@nestjs/cache-manager`                     | hard                                           | `@eleven-labs/nest-profiler-cache`         | `collectors-simple.md`      |
| `@nestjs/graphql` + `graphql`               | hard (`graphql`), optional (`@nestjs/graphql`) | `@eleven-labs/nest-profiler-graphql`       | `collectors-simple.md`      |
| `nest-commander`                            | optional                                       | `@eleven-labs/nest-profiler-commander`     | `collectors-simple.md`      |
| `@golevelup/nestjs-rabbitmq` + `amqplib`    | optional                                       | `@eleven-labs/nest-profiler-rabbitmq`      | `collectors-simple.md`      |
| `@nestjs/event-emitter`                     | hard                                           | `@eleven-labs/nest-profiler-event-emitter` | `collectors-simple.md`      |
| _(any REST/GraphQL/microservice/CLI app)_   | always available (opt-in panel)                | `@eleven-labs/nest-profiler-routes`        | `collectors-simple.md`      |

## Install and placement

- **Install** every collector with the **same flag as the core**: `-D` for the dev-dependency install, a plain `add` for the `dependencies` + `ConditionalModule` install. The host library it instruments (`@nestjs/typeorm`, `@nestjs/axios`, `@nestjs/cache-manager`…) is the app's own production dependency — never move it to `-D`.
- **Register** it in the `ProfilingModule` bundle (see `enable-strategies.md`). Collectors resolve what they instrument across the whole DI container — `DiscoveryService` scans, connection tokens resolved through `ModuleRef`, global patches — so none of them has to sit in a feature module. The per-collector snippets in the family files show the **bare** registration to add to the bundle's `imports`.
- **Gating** — dev-dependency install: none, the bundle is only loaded by `main-dev.ts`. `ConditionalModule` install: the single `ConditionalModule.registerWhen(ProfilingModule, isProfilerEnabled)` gate covers every collector in the bundle; a collector kept next to the module it instruments gets its own `ConditionalModule.registerWhen(..., isProfilerEnabled)`; with the `enabled` flag fallback, import it directly (a cheap no-op when the core is inert). Collectors need **no** no-op counterpart.
- The **app-side** configuration a collector relies on stays in the app, in production code: the ORM / `HttpModule` / `RabbitMQModule` / `EventEmitterModule` registrations, `CacheModule.register({ isGlobal: true })`, the GraphQL `context` exposing the request, and the validation pipe installed by the bootstrap.

## Asking which to add

Cross-reference `package.json` against the matrix, then **ask the user (multi-select)** which detected collectors to add — do not assume all. Same `AskUserQuestion` rules as the install choice: `header` ≤ 12 characters, technical and concrete option descriptions. Then, per chosen collector, ask its family-specific key question(s) before wiring.
