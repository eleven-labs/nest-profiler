---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-commander': patch
---

Measure CPU, memory, event-loop and garbage collection — per request, and for the process.

Until now a profile carried one resource number: `heapUsed`, the process heap at the moment the request started, documented as not being per-request. So the profiler could say a request took 300 ms but not whether it spent them computing or waiting — which is the first thing you need to know, because the two are fixed very differently.

**Per request**, alongside the duration and at a cost of two syscalls:

- `performance.cpu` — `user`, `system` and `total` CPU milliseconds. The Performance tab shows the share of the duration and names it: _CPU-bound_, _waiting on I/O_, or mixed.
- `performance.memory` — `heapUsedAfter`, `rss`, and the `heapDelta` / `rssDelta` over the request. The deltas are what a leak looks like; they can be negative when a collection freed more than the request allocated.
- `performance.eventLoop` — `utilization`, `active` and `idle` over the request's window. High utilization on a slow request means the thread was blocked.
- `performance.gc` — collections during the request and their total pause. Reported while `runtime` is enabled, since observing GC means keeping a `PerformanceObserver` alive.

**For the process**, a new **Runtime** view in the dashboard sidebar: memory and CPU trends, event-loop lag percentiles (p50/p99/max from `monitorEventLoopDelay`), garbage collection split by kind, the V8 heap spaces, and the process facts. Sampled on an interval, because a leak is a shape over time rather than a value on one request — which is exactly what a per-request figure cannot show.

- New option `runtime?: boolean | { enabled?, interval?, historySize? }`, enabled by default, sampling every 5 s and keeping 120 samples. `runtime: false` stops the interval, releases the histogram and the GC observer, and removes the view.
- New exports: `RuntimeMetricsService`, `RuntimeCollector`, `completeProfilePerformance`, `registerGcCounter`, and the `ProfilerRuntimeOptions` / `RuntimeSample` / `RuntimeCollectorData` types.
- `GlobalPanelDescriptor` gains an optional `note`, so a panel can say what kind of data it holds. Every global panel was labelled "captured at startup", which is true of Config and Discover and not of one that samples over time.
- The Runtime view is documented in the [Profiler UI](https://nest-profiler.eleven-labs.com/docs/profiler-ui) tour with its own screenshot, and the screenshot generator captures it — warmed up under traffic first, since an idle process yields flat lines and an empty GC table.
- **The process-heap strip above the list pages is removed.** The Runtime view supersedes it on every axis: it sampled `heapUsed` once per profiled request — an axis made of traffic rather than time, so idle periods vanished and bursts compressed — and its leak heuristic could flip on a single collection. It also occupied the top of every list for data belonging to none of them, and cost a dedicated storage query per page load.

Everything read comes from `node:os`, `node:v8` and `node:perf_hooks` — no dependency to install, and nothing leaves the process.

**Read the per-request figures knowing what they are:** process-wide deltas over the profile's window, not an isolated measurement of one execution. Node runs a single thread, so under concurrent traffic a request is charged with what its neighbours spent too. That is the right trade for a tool used while driving requests one at a time, and the UI states it where the numbers are shown rather than leaving it to be discovered.
