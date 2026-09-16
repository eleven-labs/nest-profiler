---
'@eleven-labs/nest-profiler': minor
---

Profile streamed responses — Server-Sent Events, LLM token streams, NDJSON, piped files. A streaming handler returns in microseconds while the transport keeps writing for seconds, so such a request used to be filed with the duration of _starting_ the stream, with one chunk recorded as its whole body, and with its collectors drained before the stream had done any work. An `@Sse()` endpoint was worse: NestJS flattens the handler's Observable into the interceptor chain, so the profile was finalized, collected and stored once per event.

A handler that takes the response over with `@Res()` is now recognised from its own route metadata — the same check NestJS makes to decide it must write nothing itself — rather than from whether headers happen to be out already. It matters for the shape an LLM endpoint takes: the handler returns, the model answers a moment later, and only then does anything reach the wire. Such a profile used to be closed and collected before the first byte, so everything the stream recorded — the outgoing calls, the queries, the model calls — was lost even though the delivery figures were not.

The profile is now closed when the response really ends, and `profile.response.stream` describes the delivery: chunk count, bytes, time to first chunk, how long the stream ran, the mean gap between chunks, and whether the client hung up mid-stream (an aborted stream is saved too — it never fires `finish`). The Response tab renders all of it. Anything recorded while the stream was running — an outgoing call, a query, a `tracer.span()` — now reaches the collector panels.

Nothing changes in an application: the figures come from the transport's own `write`/`end` calls, which the profiler already wrapped, at a cost of two integer additions per chunk and two clock readings per stream. Every wrapper forwards its arguments and return value untouched, so `res.write()` keeps signalling backpressure, and nothing is buffered from a stream.
