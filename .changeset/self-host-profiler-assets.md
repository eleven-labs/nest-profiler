---
'@eleven-labs/nest-profiler': patch
---

Self-host the profiler UI assets instead of loading them from external CDNs. Tailwind CSS is now compiled to a static stylesheet at build time and highlight.js is vendored locally; both are served same-origin under `/_profiler/__assets/*` with immutable caching. This removes the production-unsafe browser Tailwind runtime, drops all third-party CDN requests, and lets the toolbar style itself on host pages.
