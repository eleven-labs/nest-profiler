---
'@eleven-labs/nest-profiler': minor
---

Stop persisting credentials carried in a request, and make every masking list additive.

- **Query parameters are now masked at capture.** Both the stored URL and the parsed `query` had their values recorded verbatim, so a password-reset `token`, an OAuth `code`, a `state` or a URL `signature` was readable in the dashboard, in the `/_profiler/:token/data` export and in the _Copy as cURL_ command — and on disk for the whole `ttl` with file or SQLite storage. A built-in list (`token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `code`, `state`, `signature`, `sig`, `password`, `secret`, `client_secret`, `session_id`…) is masked by default, matched case-insensitively and ignoring `-`/`_`. Parameter names are kept and only values replaced, so a captured URL still reads `?token=[REDACTED]`.
- **`maskHeaders` extends the built-in list instead of replacing it.** `maskHeaders: ['x-tenant-token']` used to make that header the _only_ masked one, silently un-masking `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token` and `proxy-authorization` — the opposite of what the configuration expresses. Adding a header now never drops a built-in protection.
- **New options:** `maskQueryParams` (extra parameter names) and `useDefaultMaskQueryParams` / `useDefaultMaskHeaders` (`true` by default) to opt out of a built-in list deliberately.
- **New exports:** `DEFAULT_MASK_QUERY_PARAMS`, `buildMaskedQueryParams`, `redactQueryString`, `redactQueryRecord`.

Behaviour change: an application already passing `maskHeaders` now masks more headers than before, and captured URLs and query records may contain `[REDACTED]` where a value used to be. `ignoreRequest` still receives the unredacted request — it decides what gets profiled, so it must see what actually arrived.
