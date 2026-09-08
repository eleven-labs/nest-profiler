---
'@eleven-labs/nest-profiler-http': minor
---

Break each outgoing HTTP call into its phases — DNS, handshake, time-to-first-byte, download — behind two opt-in providers, and make the breakdown something any client can feed.

`HttpRequestEntry` gains an optional `phases` field (`HttpPhases`: `wait`, `dns`, `tcp`, `tls`, `connect`, `request`, `firstByte`, `download`, all optional durations in ms). The names are the de-facto vocabulary — `got`/`@szmarczak/http-timer` use them and they map onto the browser's `PerformanceResourceTiming` — so nothing new has to be learned to read a profile.

- **`NodeHttpPhases`** (`/phases`) wraps `request`/`get` on `node:http` and `node:https`, covering every client built on them: axios, superagent, `got`, `node-fetch`, a hand-rolled `https.request`. It is the timings-only counterpart of the `node:http` _recording_ adapter this package deliberately does not ship — the objection to that adapter was that capturing a response body means reading the stream and stealing chunks from a caller consuming it in paused mode, and a timer reads nothing.
- **`UndiciPhases`** (`/phases`) subscribes to undici's `diagnostics_channel` events, the only way to time `fetch`, which runs on undici and never goes through `node:http`. Correlation with the recorded call is exact, not heuristic: the subscribers run in the async context of the `fetch()` that triggered them, so they find that call's phase slot.
- Both providers **record nothing** — no entry, no header, no body — so neither can double-record with an adapter, and both are selected like any adapter, in `instrumentations`. Nothing is patched or subscribed unless listed.
- `readHttpPhases(source)` finds the breakdown behind whatever a custom instrumentation holds: an `AxiosResponse`, an axios error, a `ClientRequest`, an `IncomingMessage`, a `follow-redirects` wrapper (the final hop wins — its phases describe the response the caller got), or a `got` response, whose native `timings` are read without depending on `@szmarczak/http-timer`.
- `instrumentClientRequest(request)` times one request with no global patch, for a client that hands its request over (`got.stream(url).on('request', …)`). `openPhaseSlot` / `activePhaseSlot` / `phaseSlotsEnabled` expose the async-context channel for a client that exposes no transport at all. A client that measured nothing but its own time-to-first-byte can still pass `phases: { firstByte: 42 }`.
- The panel gains a **Phases** column with a stacked bar (hover a segment, or expand the row for the numbers), and the Timeline waterfall carries the same breakdown as labelled extras on the call's bar.
- A partial breakdown is the normal case and stays visible as such: a reused keep-alive connection reports no handshake, an IP literal no DNS, undici one coarse `connect` instead of dns/tcp/tls, and a `fetch` whose body is still streaming no `download` — whatever the phases do not account for is drawn as an explicit **Other** segment rather than folded into a neighbour.
- The fetch adapter enters no async context while no provider is installed, so the default hot path is unchanged.
