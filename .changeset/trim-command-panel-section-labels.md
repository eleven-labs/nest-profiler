---
'@eleven-labs/nest-profiler-commander': patch
---

Drop the explainers appended to the **Arguments** and **Options** headings of the Command tab. They restated the runner signature (`— positional operands (run(passedParams))`, `— parsed --flags (run(_, options))`) on every profile, competing with the values below them; the two headings now read `Arguments` and `Options`. What each one holds is documented on the package page, not repeated in the panel.
