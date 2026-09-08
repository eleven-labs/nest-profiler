---
'@eleven-labs/nest-profiler-commander': patch
---

Profile a command that fails before its `run()` is entered. The collector only wrapped `CommandRunner.run()`, but nest-commander evaluates the `@Option()` value parsers while commander parses the argv — i.e. before the action handler — so a parser that rejects its input (`throw new Error('Unknown site parameter')`) aborted the invocation outside the wrapper and the failed command left **no profile at all**: nothing in the Commands list, nothing under the Status "Failed" filter, while the same command succeeding was profiled normally.

- Each `@Option()` value parser is now wrapped as well: a parser that throws produces a failed command profile (`success: false`, status `500`) carrying the thrown error in the **Exceptions** tab, then the error is rethrown untouched so the CLI behaves exactly as before.
- Such a profile records the options commander had resolved so far (declared defaults included) plus the **raw** value the rejected flag was given — no parsed value exists for it — and empty `arguments`, since commander assigns the positional operands only once every option has parsed.
- Persistence goes through the core's deferred queue (`schedulePersist`), drained on application shutdown, because commander's parse phase is synchronous and cannot await a save.

Commander's own argv errors — an unknown option, a missing required option, an invalid `choices` value, or a parser throwing commander's `InvalidArgumentError` — still leave no profile: commander prints a CLI error and calls `process.exit()` itself, so nothing survives to persist one. This is now documented in the package README and in the troubleshooting guide.
