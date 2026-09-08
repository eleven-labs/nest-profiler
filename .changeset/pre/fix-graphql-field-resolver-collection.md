---
'@eleven-labs/nest-profiler': patch
---

Collect GraphQL field-resolver queries.

Over HTTP, GraphQL collection was finalized when the root resolver returned — before graphql-js runs field resolvers — so any database query issued in a `@ResolveField` was drained too early and never appeared in the collector panels (the classic N+1 stayed invisible). The middleware now marks the profile once its response-finish listener is registered, and the non-HTTP interceptor path defers `collectAll()` to that hook, which fires after every field resolver. Genuine non-HTTP transports (no finish hook) keep collecting inline as before.
