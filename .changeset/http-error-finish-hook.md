---
'@eleven-labs/nest-profiler': patch
---

Close a failing HTTP profile once the exception filters have answered: the profile now records the status and body the filter wrote (a domain error answered 409 was stored as 500, with no body) and keeps the lines the filter logged.
