---
'@eleven-labs/nest-profiler': patch
---

Move the process-heap trend above the page title on the profiler home page.

The trend was rendered inside the active list view, next to the HTTP / GraphQL / Command list it happened to be shown with — which read as "the heap of these profiles" when it is process-wide data, sampled at request start across the 30 most recent profiles regardless of entrypoint. It now sits above the **Recent Profiles** heading, and shows on the global panel views too instead of disappearing whenever a non-list view was open.
