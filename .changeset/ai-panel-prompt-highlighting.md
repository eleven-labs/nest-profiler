---
'@eleven-labs/nest-profiler-ai': patch
---

Stop colouring words inside prompts in the AI panel. The system prompt, the messages sent, the reasoning and the completion are prose, so they now opt out of highlight.js, which used to guess a programming language for them and paint words like `is` or `in` as keywords. The structured output section also gets the top spacing its sibling sections have, instead of sitting against the completion above it.
