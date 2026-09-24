---
'@eleven-labs/nest-profiler-ai': minor
'@eleven-labs/nest-profiler': minor
---

Record what each model call exchanged with its provider. The new opt-in `providerPayload` capture field stores the request body the AI SDK sent and the response headers and body the provider answered before the SDK normalised them — plus the endpoint, status and error body of a refused call — read from the provider's own result inside the registered telemetry integration, so no call site needs `include`. The HTTP request a model call makes now nests under that call in the trace when `@eleven-labs/nest-profiler-http`'s fetch adapter is installed. `generateText`'s `output` setting (`Output.object()`…), which replaces the deprecated `generateObject`, now records its strategy, schema, name and parsed object like `generateObject` did. The core gains `runAsSpanParent`, an `id` option on `entriesToSpans`, and exports `DEFAULT_SECRET_KEY_RE`.
