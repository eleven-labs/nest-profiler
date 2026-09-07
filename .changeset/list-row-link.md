---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-graphql': minor
'@eleven-labs/nest-profiler-commander': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
---

Drop the Token column from every profile list, lead with Time and Duration, and make the whole row the link.

- The **Token** column is gone from the HTTP, GraphQL, Commands and RabbitMQ lists: the token identifies the profile in the URL, in the `X-Debug-Token` header and on the detail page, so repeating a truncated copy on every row only pushed the columns that discriminate one execution from another out of the way.
- Every list now opens on **Time** then **Duration** — when an execution happened and what it cost — before the columns specific to its kind.
- The detail tables follow the same order: SQL queries, Mongoose queries, HTTP client calls, cache operations and the execution timeline all lead with Time then Duration, so a table reads the same wherever it sits.
- The row is the link: no cell owns it any more. A new `row-link` client behaviour navigates on a click anywhere in a `[data-row-href]` row, opens a new tab on ctrl/meta or middle click, and follows a focused row on `Enter`. Nested interactive elements and clicks that end a text selection are left alone.
- Custom list sections: put the profile URL in `data-row-href` on the `<tr>` and add `tabindex="0"` (a `<tr>` is not focusable on its own) to get the same behaviour.
- The attribute is validated before it is followed: only a same-origin path navigates, never a `javascript:`, protocol-relative or cross-origin value.
