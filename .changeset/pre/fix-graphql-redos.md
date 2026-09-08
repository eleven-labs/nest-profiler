---
'@eleven-labs/nest-profiler-graphql': patch
---

Parse GraphQL HTTP bodies with the `graphql` package (now declared as a peer dependency) instead of regex-based field detection, removing the regex backtracking risk on crafted queries.
