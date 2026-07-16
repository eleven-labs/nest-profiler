---
'@eleven-labs/nest-profiler': patch
---

Capture the response body of error responses written by an exception filter.

- On the `catchError` path the interceptor finalizes `profile.response` before the exception filter produces the body, so `response.body` was left `undefined` while successful responses captured theirs. The finish hook then bailed out because `profile.response` was already set, dropping the payload the client actually received.
- The middleware finish hook now backfills `response.body` from the intercepted `res.json/send/end` output when the profile carries an exception, its body is still `undefined`, and `collectBody` is enabled — symmetrical to the existing GraphQL envelope backfill. The success path and the response status code are left untouched.
