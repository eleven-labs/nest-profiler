# @eleven-labs/nest-profiler-axios

> **Deprecated.** This package has been renamed to [`@eleven-labs/nest-profiler-http`](https://www.npmjs.com/package/@eleven-labs/nest-profiler-http). It now only re-exports that package so existing imports keep working.

## Migration

```bash
pnpm remove @eleven-labs/nest-profiler-axios
pnpm add @eleven-labs/nest-profiler-http
```

```diff
- import { AxiosCollectorModule } from '@eleven-labs/nest-profiler-axios';
+ import { AxiosCollectorModule } from '@eleven-labs/nest-profiler-http';
```

The API is unchanged. See the [`@eleven-labs/nest-profiler-http` docs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http).

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
