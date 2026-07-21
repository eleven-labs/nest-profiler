---
'@eleven-labs/nest-profiler': patch
---

Serialize non-plain values meaningfully in `toSafeData()` instead of collapsing them to `'[Object]'`.

- `toSafeData()` (used for captured log payloads, request/response bodies, and any `safeStringify` sink) fell through to the literal `'[Object]'` for every object that was not a plain object, `Error`, `Date`, `Map`, `Set` or typed array. A logged `URL`/`URI` therefore rendered as `"uri": "[Object]"`, and `RegExp` and other class instances were collapsed the same way — the exact bug already fixed in `redact()`.
- `URL`/`RegExp` are now stringified (`URL` → its href, `RegExp` → its source form), aligned with `redact()`.
- Remaining class instances prefer their `toJSON()` projection when present, else fall back to own-enumerable enumeration (capped by `maxItems`) instead of being dropped as `'[Object]'`.
