import { safeStringify } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

/**
 * The argument an operation was called with, as rendered in the panel and in the `mongosh`
 * command: the pipeline of an aggregation, the operations of a `bulkWrite`, the documents of a
 * `save` / `insertMany`, and the filter of every other query. Falls back to an empty filter when
 * nothing was captured.
 */
export function commandArgument(entry: MongooseQueryEntry): unknown {
  if (entry.operation === 'aggregate') return entry.pipeline ?? [];
  if (entry.operations) return entry.operations;
  if (entry.documents) {
    // A `save` writes exactly one document — unwrap it so the command mirrors the call.
    const [document] = entry.documents;
    return entry.operation === 'save' && entry.documents.length === 1 ? document : entry.documents;
  }
  return entry.filter ?? {};
}

/**
 * Builds a runnable `mongosh` command from a captured query, mirroring the
 * Symfony Web Profiler "copy query" feature:
 *
 * - aggregations → `db.<collection>.aggregate([<pipeline>])`
 * - writes → `db.<collection>.<operation>([<documents|operations>])`
 * - updates → `db.<collection>.<operation>(<filter>, <update>)`
 * - everything else → `db.<collection>.<operation>(<filter>)`
 *
 * The argument is rendered as indented JSON so it pastes cleanly into a shell. `safeStringify`
 * is used so a circular reference or `BigInt` in an argument can't throw and drop the whole
 * MongoDB panel.
 */
export function buildMongoCommand(entry: MongooseQueryEntry): string {
  const args = [safeStringify(commandArgument(entry), 2)];
  if (entry.update !== undefined) args.push(safeStringify(entry.update, 2));
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
 * where `<shape>` is the operation's argument (filter, pipeline, or written payload) — followed
 * by the update's shape for an update — with concrete values stripped. Two executions of the same operation with different bound values
 * share a fingerprint, so the engine can flag them as an N+1 pattern.
 */
export function buildMongoFingerprint(entry: MongooseQueryEntry): string {
  const shapes = [JSON.stringify(shapeOf(commandArgument(entry)))];
  if (entry.update !== undefined) shapes.push(JSON.stringify(shapeOf(entry.update)));
  return `${entry.operation} ${entry.collection} ${shapes.join(' ')}`;
}
