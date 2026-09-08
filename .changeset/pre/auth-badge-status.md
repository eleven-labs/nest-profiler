---
'@eleven-labs/nest-profiler-auth': minor
---

Make the Security collector badge a compact auth status instead of the raw user identifier.

- Authenticated requests now show a concise badge instead of the full identifier (often a long email that wrapped the sidebar row). The complete identity stays in the panel detail.
- New `badge` option (default `'status'`): `'status'` shows a fixed `auth` label (mirrors `anon`), `'role'` shows the first role and falls back to `auth`, `'identifier'` keeps the legacy `username ?? email ?? sub ?? id` behaviour.
- New `badgeValue` resolver for full control — receives the `SecurityContext`, takes precedence over `badge`, and may return `null` to hide the badge. It runs only for authenticated requests; unauthenticated requests always show `anon`.
- New export: `AuthBadgeMode`.
- Behaviour change: the default authenticated badge is now `auth` instead of the user identifier. Set `badge: 'identifier'` to restore the previous output.
