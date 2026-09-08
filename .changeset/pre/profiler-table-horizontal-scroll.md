---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-graphql': patch
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-routes': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-validator': patch
---

Make the profiler-UI tables horizontally scrollable on narrow/mobile viewports (fixes #184).

Every list-section table (HTTP, GraphQL, Command, RabbitMQ) and several collector-panel tables (schema, timeline, routes, cache, validator) were wrapped in an `overflow-hidden` container (there to clip the rounded corners), which also clipped horizontal overflow with no scrollbar — so on a phone the wide tables were squished and the right-hand columns became unreachable. Each wide table now sits in an `overflow-x-auto` container with a sensible `min-w`, so a table too wide to fit scrolls horizontally within its own card (rounded corners preserved) while the page body itself never scrolls sideways.
