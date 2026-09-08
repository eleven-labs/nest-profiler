---
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-config': patch
'@eleven-labs/nest-profiler-auth': patch
---

Fix the collector options that an import cycle was silently dropping.

`MongooseConnectionPatch`, `ConfigCollector` and `AuthCollector` imported their options token from their own module file, which imports them back: the token was still `undefined` when the class decorators ran, so `@Inject(undefined)` left no token in the injection metadata and the `@Optional()` parameter default took over — the class always received `{}`. `maskKeys` (config), `badge` / `badgeValue` / `maskUserFields` (auth) and `connectionName` (the Mongoose connection patch) were therefore inert, so a key you asked to mask was rendered in clear in the Config panel. Each token now lives next to its `ConfigurableModuleBuilder` in a cycle-free `*-collector.interface.ts` — the layout `nest-profiler-mongoose` already used for `MongooseCollector` — and a regression test asserts the resolved token is present in each class's injection metadata. The module files keep re-exporting the token, so the public API is unchanged.
