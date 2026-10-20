---
'@eleven-labs/nest-profiler': patch
---

Capture the syslog levels (`notice`, `warning`, `crit`, `critical`, `alert`, `emerg`, `emergency`) in `DEFAULT_LOG_METHODS`, so a logger exposing them no longer loses those lines from the profile.
