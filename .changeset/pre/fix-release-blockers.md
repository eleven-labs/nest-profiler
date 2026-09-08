---
'@eleven-labs/nest-profiler-http': patch
'@eleven-labs/nest-profiler': patch
---

Fix two release blockers.

- **http**: the package no longer references `@nestjs/axios` at all (no import, no lazy `require`). Installing `@eleven-labs/nest-profiler-http` never touches the peer, so a "bring your own client" (fetch/undici/got) setup can't crash at import. To instrument axios you now hand the collector your `HttpService.axiosRef` via `HttpCollectorModule.forRootAsync({ inject: [HttpService], useFactory: (http) => ({ axiosRef: http.axiosRef }) })`; the axios adapter no-ops when no `axiosRef` is provided.
- **core**: the injected toolbar now loads a dedicated, preflight-free stylesheet (`toolbar.css`) scoped under `#profiler-toolbar`, instead of the full `profiler.css`. Tailwind's universal preflight reset is no longer applied to profiled host pages, so enabling the toolbar no longer breaks the host application's layout.
