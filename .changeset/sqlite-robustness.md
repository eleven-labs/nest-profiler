---
'@eleven-labs/nest-profiler': minor
---

Harden the SQLite storage backend for cheaper saves and a more resilient open path.

- **Memoized prepared statements**: every query is compiled once per SQL shape and reused, instead of re-preparing (notably the per-save `INSERT`) on every call.
- **Counter-derived eviction**: an in-memory row count (kept exact across re-saves, re-synced from `COUNT(*)` to absorb writes by another process) gates trimming, so a save no longer sorts the whole table below the cap. The TTL sweep is amortized — reads already enforce the TTL — while the overflow trim stays synchronous and only fires once actually over `maxProfiles`.
- **Resilient open path**: open failures are wrapped in an actionable, `cause`-chained error naming the resolved path. New `onCorruption: 'recreate' | 'throw'` option (default `'recreate'`) moves a corrupt file aside to `<path>.corrupt-<timestamp>` (sidecars included) and starts fresh, or rethrows.
- **New `busyTimeout` option** (default `5000` ms) tunes how long a write waits on a concurrent writer of the same file database.
