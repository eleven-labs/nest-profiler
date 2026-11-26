---
'@eleven-labs/nest-profiler-pubsub': minor
'@eleven-labs/nest-profiler': patch
---

Add `@eleven-labs/nest-profiler-pubsub`: `PubSubPublishCollectorModule` lists the Google Cloud Pub/Sub messages a profiled request publishes through `@google-cloud/pubsub` in a **Pub/Sub** panel — topic, attributes (masked), ordering key, payload, server-assigned message id, duration and outcome — with the slow / N+1 / chatty / error tags and a runnable `publishMessage` snippet. The core names a repeated Pub/Sub publish a repeated "message" in the N+1 detail.
