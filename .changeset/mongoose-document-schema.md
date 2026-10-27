---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-mongoose': minor
---

Show the Mongoose schema as documents rather than relational tables. The Schemas / Mongoose panel now lists embedded documents, arrays of subdocuments and nested objects under the field holding them, finds the references declared inside them, and names references `ref` / `ref[]` instead of a relational cardinality (`many-to-one` / `one-to-many`). A reference is now also listed as a field, and arrays show their element type (`String[]`). The panel opens with a Mermaid **Document diagram**: one block per model and embedded document, solid lines for embedding and dashed lines for references, and a shape embedded in several places (an address used for shipping and billing) drawn once. Schema collectors can declare a `document` data model, which switches the panel to fields, required and references.
