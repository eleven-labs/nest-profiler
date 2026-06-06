---
'@eleven-labs/nest-profiler': patch
---

Surface collector failures instead of hiding them. A failing collector now logs a warning and stores its real error message (rather than a generic `Collection failed`), and global-panel collection is guarded too, so a throwing global collector can no longer bubble out of the controller.
