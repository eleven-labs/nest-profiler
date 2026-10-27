# @eleven-labs/nest-profiler-mongoose

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-mongoose" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mongoose"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-mongoose` captures every Mongoose query and aggregation executed during a profiled execution and displays them in a dedicated **MongoDB** panel.

![MongoDB panel — Mongoose queries and aggregations with operation badge, collection, duration and result count](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/mongodb.png)

## Installation

```bash
pnpm add -D @eleven-labs/nest-profiler-mongoose
```

**Peer dependencies:** `mongoose ^9.0.0`, `@nestjs/mongoose ^11.0.0 || ^12.0.0` — your app's own dependencies, installed with a plain `pnpm add`.

## Setup

Keep `MongooseModule.forRoot()` (or `forRootAsync`) and your `MongooseModule.forFeature([...])` calls in your application modules, and register the collector in the dev-only profiling bundle:

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    MongooseCollectorModule.forRoot({
      slowThreshold: 100,
      nPlusOneThreshold: 2,
      slowSeverity: 'warning',
    }), // slow/N+1 tagging + severity
  ],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

The collector resolves the Mongoose connection by its injection token (pass `connectionName` for a named connection) and patches `Query` / `Aggregate` process-wide, so it needs no wiring in the feature modules that declare your schemas.

## What it collects

For each Mongoose query or aggregation executed during a request:

| Field         | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| `collection`  | MongoDB collection name (e.g. `reviews`)                              |
| `operation`   | Mongoose operation (e.g. `find`, `aggregate`)                         |
| `filter`      | Query filter object (if applicable)                                   |
| `update`      | Update document of `update*` / `findOneAndUpdate` / `replace*`        |
| `field`       | Field of a `distinct`                                                 |
| `projection`  | Fields a read returns (`select()`)                                    |
| `options`     | Options sent along (`sort`, `limit`, `upsert`, `arrayFilters`…)       |
| `documents`   | Documents written by `insertOne` (a `save()`) / `insertMany`          |
| `operations`  | Bulk operations passed to `bulkWrite`                                 |
| `duration`    | Execution time in ms                                                  |
| `startedAt`   | Unix timestamp                                                        |
| `count`       | Documents returned (reads) or affected (writes)                       |
| `result`      | Documents the operation resolved to — only when `captureResult` is on |
| `error`       | Error message if the query failed                                     |
| `streaming`   | `true` for streaming reads (`Query.cursor()` / `Aggregate.cursor()`)  |
| `connection`  | Connection endpoint `host:port` (no credentials)                      |
| `database`    | Target database name                                                  |
| `fingerprint` | `collection + operation + argument shape`, for N+1 grouping           |
| `tags`        | Performance tags applied by the core rule engine                      |

`filter`, `update`, `field`, `projection`, `options`, `pipeline`, `documents` and `operations` are the operation's _arguments_: they are always captured (no `captureResult` needed), passed through the shared redaction, and shown in the panel with a **Copy query** button that yields a runnable `mongosh` command. They are read as Mongoose sent them: an update has its top-level fields under `$set` and the `updatedAt` of the timestamps plugin, the session is left out of the options. Written documents go through their `toJSON()` projection, and unlike `result` they are never size-capped — a bulk operation is naturally deeper than the default `maxDepth`.

`count` is derived from what the operation resolved to: the array length for `find` / `distinct` / `aggregate`, the number itself for `countDocuments` / `estimatedDocumentCount`, `1` or `0` for single-document reads (`findOne`, `findById`, `findOneAnd*`), the write acknowledgement for `update*` / `delete*` / `replace*` (`deletedCount`, or `modifiedCount` plus `upsertedCount` so an upsert counts as affected), the documents inserted, modified, deleted or upserted by a `bulkWrite`, and the documents an `insertMany` inserted — even when it failed part-way. When the shape is not recognized the field stays unset and the panel omits it rather than showing a wrong figure. Streamed row counts are not captured.

Slow queries, N+1 patterns and silent zero-count `delete`/`update`s (the `zero-rows` tag) are flagged by the core rule engine and shown as coloured pills (and filterable on the list page). See [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).

## Capturing results

The documents an operation returned are **not** captured by default — a result set carries the very data the query read. Enable `captureResult` to display them in a collapsible **Result** block under each row:

```ts
MongooseCollectorModule.forRoot({
  captureResult: true, // off by default
  resultLimits: { maxItems: 20, maxDepth: 4, maxStringLength: 512 },
});
```

Captured documents are flattened through their `toJSON()` projection, capped by `resultLimits` (`maxItems` bounds both the documents kept and the keys kept per document, the rest collapsing to a `… +N more` marker) and passed through the shared redaction, so a field named `password`, `token`, `secret`… is masked before it reaches the profile. They are still written to profile storage: keep this off outside local development.

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `4q`). When slow queries are present: `4q (1 slow)`.

## How it works

At module initialization, the collector patches `mongoose.Query.prototype.exec` and `mongoose.Aggregate.prototype.exec` on the Mongoose instance retrieved from `connection.base`. This captures all queries regardless of when schemas were registered, and is fully transparent — Mongoose behavior is unchanged.

**Writes** — `document.save()`, `Model.insertMany()` and `Model.bulkWrite()` bypass `Query.exec()`, so they are patched as well, along with `Model.prototype.$save` — the frozen alias of `save` that `Model.create()` and `Model.insertOne()` call internally, and that patching `save` alone would miss (`Model.bulkSave()` routes through `bulkWrite`). Each write records the payload it sent, read once it settled since Mongoose fills it while it runs (defaults, `_id`, timestamps, casting): the inserted documents under `documents`, the bulk operations under `operations`. A `save()` is recorded as the operation it sends: an `insertOne` of the whole document when it is new, an `updateOne` of the delta of its modified paths when it exists, and the `findOne` Mongoose only checks it still exists with when nothing was modified.

**Not captured** — calls made on the native driver, bypassing Mongoose: `Model.collection.insertOne()`, `connection.db.collection(…)`, and so on.

**Streaming reads** — `Query.cursor()` and `Aggregate.cursor()` bypass `exec()`, so they are patched too. The read is recorded (with `streaming: true`) at cursor creation, so it is captured whatever the consumption pattern. Its `duration` is finalized from the cursor's terminal `close`/`end`/`error` events when they fire — which they do for flowing / `pipe()` / explicit `close()` consumption, but **not** for `for await` or `eachAsync()` on a Mongoose cursor (they emit no terminal event); those keep `duration: 0` and are labelled `not timed (stream)` in the panel's Duration column. Measuring their duration would require wrapping the row iterator, a per-document cost we avoid. Streamed row counts are not captured.

## Schema panel

`MongooseSchemaCollectorModule` adds a global **Schemas / Mongoose** view to the profiler home page, listing every registered model with its fields (type, required, `_id`, default), references (`ref` → target model) and indexes (name, fields, unique). Unlike the per-request MongoDB panel, this is static process-level data introspected **once** at startup — so it renders on the home page, under the sidebar's **Schemas** heading, not inside a profile.

Add it to the profiling bundle's `imports`:

```ts title="profiling/profiling.module.ts"
import { MongooseSchemaCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

MongooseSchemaCollectorModule.forRoot(),
```

Pass `connectionName` to introspect a named connection (omit it for the default), and `enabled: false` to disable per environment. The panel reads each model's `schema.paths` and `schema.indexes()` and never touches data; path defaults are passed through the profiler's `redactString`, so a default embedding a secret is masked. The panel no-ops (does not appear) when no Mongoose connection is wired.

### Document structure

The panel shows each model the way MongoDB stores it, not as a relational table:

- **Embedded documents and nested objects** are listed under the field holding them, one level deeper: a subdocument (`Subdocument`), an array of subdocuments (`Subdocument[]`) and a plain nested object (`Object`) each show their own fields, with the full dotted path (`items.product`) on hover. Arrays of values show their element type (`String[]`, `ObjectId[]`).
- **References** are listed as `ref` (one id) or `ref[]` (an array of ids) with the model they name, including the ones declared inside an embedded document. A reference is also a field: it is an id stored in the document. No cardinality is inferred — the database never checks a `ref`, it only tells `populate()` which model to read.
- Fields show whether they are **required** rather than nullable. Only the document's own `_id` is its primary key; the `_id` of an embedded document is listed as generated.

A recursive schema (a document embedding its own kind) is expanded once.

### Document diagram

The panel opens with a collapsible **Document diagram** section, a [Mermaid](https://mermaid.js.org) diagram of the registered models:

- one block per model, and one per embedded document or nested object, labelled with its path (`Order.items[]`);
- a **solid line** from a document to what it embeds: an embedded document lives in exactly one parent, which holds one or an array of them;
- a **dashed line** for every `ref`, labelled with the field: any number of documents may hold one, and it points at one document (`ref`) or several (`ref[]`).

A shape embedded in several places — an address schema used for `shipping`, `billing` and a customer's `addresses[]` — is drawn **once**, named after the fields embedding it (`shipping / billing / addresses`), with a solid line from each of them. Shapes are recognised by their structure (fields, types, requiredness, references), so two identical schemas built separately, as `@nestjs/mongoose` does for every `@Prop`, count as one. A plain nested object always belongs to its own field.

`_id` is marked `PK` and a single-field unique index `UK`. A `ref` to a model the application does not register is drawn as an empty block.

The diagram is rendered in the browser and nothing has to be installed: the first time the section is opened, the profiler page loads Mermaid from jsDelivr — a single, version-pinned file checked against its Subresource Integrity hash, and the only third-party URL the profiler's CSP allows. When the CDN is unreachable (offline or air-gapped machines), the section shows the Mermaid source instead. **Copy Mermaid** copies that source in every case, ready to paste into a README, a GitHub comment or [mermaid.live](https://mermaid.live).

The diagram is drawn in a pannable, zoomable viewport so large schemas stay legible: drag to pan, **Ctrl / ⌘ + scroll** (or pinch, or double-click) to zoom around the cursor, and use the toolbar to zoom, return to 100 %, fit the whole diagram or expand it to the full window (**Esc** to leave). **Go to model** centres and highlights one block. While the diagram has focus, `+` / `-` zoom, `0` fits, `1` returns to 100 % and the arrow keys pan.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
