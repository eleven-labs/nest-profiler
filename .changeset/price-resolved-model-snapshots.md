---
'@eleven-labs/nest-profiler-ai': patch
---

Cost a call whose provider answered as another model. OpenAI resolves `gpt-4o-mini` to the dated snapshot `gpt-4o-mini-2024-07-18` and reports the snapshot back, so a price table keyed on the ids an application actually asks for — which is what a registry of models holds — matched nothing, and such a call was filed as `unknown` even though its prices were configured.

The resolved id remains what the call is recorded and priced as, since it is what ran; only when nothing prices it is the id the call was made with tried, read from the operation the step belongs to. A price set on the snapshot itself therefore still wins over the one asked for, and a cost the provider reported itself wins over both.
