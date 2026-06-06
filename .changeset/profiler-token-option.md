---
'@eleven-labs/nest-profiler': minor
---

Add a `token` option to `ProfilerModule.forRoot()` for securing the profiler UI.

The guard now resolves the bearer token as `options.token ?? process.env.PROFILER_TOKEN`, so it can be configured through module options instead of only the environment — keeping packages free of direct `process.env` reads. Fully backward compatible: the `PROFILER_TOKEN` environment variable still works.
