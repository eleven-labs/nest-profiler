---
'@eleven-labs/nest-profiler': major
---

Replace the built-in profiler token with a pluggable `security` option so consumers can enforce **any** authentication on the UI/API.

**BREAKING:** the `token` option and its `PROFILER_TOKEN` environment fallback are removed. Reproduce them with a `security.authorize` predicate (see the migration snippet below).

- **Removed** (breaking): the `token` option and its `PROFILER_TOKEN` environment fallback. The profiler stays **open by default** (no authentication).
- **Added**: `security` on `ProfilerModuleOptions`, combining `authorize` (a `(ctx) => boolean | Promise<boolean>` predicate over the platform-agnostic `request`/`response`), `guards` (NestJS `CanActivate` classes resolved through DI, or ready instances), and `linkQuery` (threads a query-param credential through the UI links). Providing several strategies requires **all** to pass; providing none keeps the profiler open. Static assets stay exempt.
- **Fixed**: the JSON export link (`/:token/data`) and UI navigation now carry the visitor's credential — cookies/sessions/Basic auth propagate natively, and query-param schemes propagate via `linkQuery`.
- New exports: `ProfilerSecurityOptions`, `ProfilerAuthorize`, `ProfilerAuthContext`, `ProfilerGuard`, `PlatformRequest`, `PlatformResponse`.

Migration — replace `token: process.env.PROFILER_TOKEN` with an `authorize` predicate:

```ts
ProfilerModule.forRoot({
  security: {
    authorize: ({ request }) =>
      request.headers['authorization'] === `Bearer ${process.env.PROFILER_TOKEN}`,
  },
});
```
