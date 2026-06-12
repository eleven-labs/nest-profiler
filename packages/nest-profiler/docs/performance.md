Profiling adds no measurable latency to your endpoints: the response (or the thrown error) is forwarded immediately, and the collectors plus the storage write run **after** it has been sent. The only exception is HTML pages, which wait for the collectors so the injected toolbar can render its panels. Pending writes are drained on application shutdown, so short-lived processes do not lose their last profiles.

## Consequences of deferred persistence

Two consequences to be aware of:

- A client following `X-Debug-Token-Link` right after receiving the response may briefly get a 404 — the profile typically lands within a few milliseconds, never slow enough for a human click to notice.
- Automated tests that assert on a stored profile right after a request must wait for the deferred persistence with `ProfilerService.flush()`.

## Testing with `flush()`

```ts
import { ProfilerService } from '@eleven-labs/nest-profiler';

const res = await request(app.getHttpServer()).get('/users');
await app.get(ProfilerService).flush(); // waits for the deferred collect + save

const profile = await request(app.getHttpServer()).get(
  `/_profiler/${res.headers['x-debug-token']}/data`,
);
```

`flush()` is a safe no-op when the profiler is disabled.

## Bounding the overhead

Three options keep the background work itself in check (see the [Configuration](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration) page for the full reference):

- `collectorTimeout` — abandons any single collector that runs longer than the limit (default 1000 ms).
- `sampleRate` — profiles only a fraction of requests on busy environments.
- `ignorePaths` — skips noisy paths entirely; browser/tooling probes (favicon, robots.txt, Chrome DevTools) are skipped by default.
