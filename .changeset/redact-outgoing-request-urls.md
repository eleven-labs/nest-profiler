---
'@eleven-labs/nest-profiler-http': minor
---

Mask credentials carried in the query string of an outgoing request.

The URL of every captured outgoing call was recorded verbatim, so an upstream API key, an access token or a signed-URL signature passed as a query parameter was readable in the HTTP Client panel, in the `/_profiler/:token/data` export and on disk for the whole `ttl` — while the _headers_ of the same call were already masked.

- Query-parameter values are now masked in the recorded URL, from the core's built-in list (`token`, `access_token`, `refresh_token`, `api_key`, `code`, `state`, `signature`, `password`, `secret`, `client_secret`…), matched case-insensitively and ignoring `-`/`_`. Parameter names are kept and only values replaced, so a recorded URL still reads `?api_key=[REDACTED]`.
- **New options:** `maskQueryParams` (extra parameter names, merged with the built-ins) and `useDefaultMaskQueryParams` (`true` by default) to opt out of the built-in list deliberately — the same additive shape as `maskHeaders`.
- **New exports:** `DEFAULT_MASK_QUERY_PARAMS`, `redactQueryString`, `resolveMaskedQueryParams`.

Masking is applied by `HttpProfilerRecorder.capture()`, which both bundled instrumentations (axios, fetch) and the recommended custom-client path go through. `record()` and `appendHttpRequestEntry()` keep bypassing every capture flag and all masking by design — they append the entry you built as-is — so redact the URL yourself with the exported `redactQueryString` when you use them.

The N+1 fingerprint is unaffected: it is built from method, host and path, and never included the query string.
