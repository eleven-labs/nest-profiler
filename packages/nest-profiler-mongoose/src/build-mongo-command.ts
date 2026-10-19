import { safeStringify } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

/**
 * The argument an operation was called with, as rendered in the panel and in the `mongosh`
 * command: the pipeline of an aggregation, the operations of a `bulkWrite`, the documents of an
 * `insertOne` / `insertMany`, and the filter of every other query. Falls back to an empty filter
 * when nothing was captured.
 */
export function commandArgument(entry: MongooseQueryEntry): unknown {
  if (entry.operation === 'aggregate') return entry.pipeline ?? [];
  if (entry.operations) return entry.operations;
  if (entry.documents) {
    // An `insertOne` writes exactly one document — unwrap it so the command mirrors the call.
    const [document] = entry.documents;
    return entry.operation === 'insertOne' && entry.documents.length === 1
      ? document
      : entry.documents;
  }
  return entry.filter ?? {};
}

/** Reads whose projection is their second `mongosh` argument; others take it as an option. */
const PROJECTION_ARGUMENT_OPERATIONS = new Set(['find', 'findOne']);

/**
 * Every argument of the `mongosh` call, in order: the field of a `distinct`, the main argument
 * (see {@link commandArgument}), the update, the projection of a read, then the options — the
 * projection of any other operation moving into them. `estimatedDocumentCount` only takes options.
 */
function commandArguments(entry: MongooseQueryEntry): unknown[] {
  if (entry.operation === 'estimatedDocumentCount') return entry.options ? [entry.options] : [];
  const args: unknown[] = entry.field === undefined ? [] : [entry.field];
  args.push(commandArgument(entry));
  if (entry.update !== undefined) args.push(entry.update);
  let options = entry.options;
  if (PROJECTION_ARGUMENT_OPERATIONS.has(entry.operation)) {
    // A find's options are its third argument: keep the projection slot when there is none.
    if (entry.projection || options) args.push(entry.projection ?? {});
  } else if (entry.projection) {
    options = { ...options, projection: entry.projection };
  }
  if (options) args.push(options);
  return args;
}

/**
 * Builds a runnable `mongosh` command from a captured query, mirroring the
 * Symfony Web Profiler "copy query" feature:
 *
 * - aggregations → `db.<collection>.aggregate([<pipeline>], <options>)`
 * - writes → `db.<collection>.<operation>([<documents|operations>])`
 * - updates → `db.<collection>.<operation>(<filter>, <update>, <options>)`
 * - reads → `db.<collection>.<operation>(<filter>, <projection>, <options>)`
 * - `distinct` → `db.<collection>.distinct(<field>, <filter>, <options>)`
 *
 * Options and projection are passed only when the operation was sent with some.
 * The argument is rendered as indented JSON so it pastes cleanly into a shell. `safeStringify`
 * is used so a circular reference or `BigInt` in an argument can't throw and drop the whole
 * MongoDB panel.
 */
export function buildMongoCommand(entry: MongooseQueryEntry): string {
  const args = commandArguments(entry).map((arg) => safeStringify(arg, 2));
  return `db.${entry.collection}.${entry.operation}(${args.join(', ')})`;
}

/**
 * Reduces a value to its shape: objects keep their (sorted) keys, arrays keep their
 * element shapes, and every leaf value collapses to `?`. Field names and operators
 * (`$gt`, `$in`…) are preserved; concrete values are not.
 */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = shapeOf((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return '?';
}

/**
 * Builds a value-free fingerprint for a Mongo operation — `operation collection <shape>`
 * where `<shape>` is the operation's argument (filter, pipeline, or written payload) — preceded
 * by the field of a `distinct`, followed by the update's shape for an update — with concrete
 * values stripped. Two executions of the same operation with different bound values
 * share a fingerprint, so the engine can flag them as an N+1 pattern.
 */
export function buildMongoFingerprint(entry: MongooseQueryEntry): string {
  const parts = [entry.operation, entry.collection];
  if (entry.field !== undefined) parts.push(entry.field);
  parts.push(JSON.stringify(shapeOf(commandArgument(entry))));
  if (entry.update !== undefined) parts.push(JSON.stringify(shapeOf(entry.update)));
  return parts.join(' ');
}
