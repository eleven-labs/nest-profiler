---
'@eleven-labs/nest-profiler': patch
---

Keep the profiler UI reachable at `/_profiler` under a host app's routing.

`/_profiler` was the mount point _and_ the value hardcoded into every link pointing at it, so any routing transform the host applied to its own controllers moved the UI while its links stayed behind. The profiler is tooling, not part of the API surface, so it now stays at `/_profiler` whatever the app does — with nothing for the consumer to declare.

- **URI versioning made the UI unreachable.** `ProfilerController` was a plain `@Controller()`, so it inherited the app's `defaultVersion`: with `enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` the whole UI moved to `/v1/_profiler` and `GET /_profiler` returned `404`. The controller is now `VERSION_NEUTRAL` — no version scheme (URI, header or media-type) applies to it, and your own routes keep their versions.
- **A global prefix moved the UI and broke its links.** `setGlobalPrefix('api/v1')` pushed the profiler to `/api/v1/_profiler` while its rendered asset/navigation links, the injected toolbar and the `X-Debug-Token-Link` header still pointed at `/_profiler` — a page with no styles and dead links. The profiler now opts itself out of the global prefix, so it stays at `/_profiler` and everything pointing at it stays correct. Listing `_profiler` in your own `exclude` is no longer needed (and won't double up if you keep it).

Documented under [Configuration → Versioning and global prefix](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration).
