---
'@eleven-labs/nest-profiler': patch
---

Capture exceptions thrown by guards (and anything running before the interceptor) in the profile's Exceptions tab.

Guards run before interceptors in the NestJS lifecycle, so `ProfilerInterceptor.catchError` never saw exceptions such as an auth guard's `UnauthorizedException`: the 401 profile recorded the right status and security context but its `exceptions` array stayed empty. A new global `ProfilerExceptionFilter` (registered only in the enabled layer) observes the exception on its way out and records it on the active profile, then delegates to `BaseExceptionFilter` so the framework's default response formatting is preserved. Only HTTP requests are touched — GraphQL/RPC errors remain handled by the interceptor.
