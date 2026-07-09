import { safeStringify } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

/**
 * Builds a runnable `mongosh` command from a captured query, mirroring the
 * Symfony Web Profiler "copy query" feature:
 *
 * - aggregations → `db.<collection>.aggregate([<pipeline>])`
 * - everything else → `db.<collection>.<operation>(<filter>)`
 *
 * The argument is rendered as indented JSON so it pastes cleanly into a shell. `safeStringify`
 * is used so a circular reference or `BigInt` in a filter/pipeline can't throw and drop the
 * whole MongoDB panel.
 */
export function buildMongoCommand(entry: MongooseQueryEntry): string {
  const target = `db.${entry.collection}`;

  if (entry.operation === 'aggregate') {
    const pipeline = entry.pipeline ?? [];
    return `${target}.aggregate(${safeStringify(pipeline, 2)})`;
  }

  const filter = entry.filter ?? {};
  return `${target}.${entry.operation}(${safeStringify(filter, 2)})`;
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
 * where `<shape>` is the filter (or aggregation pipeline) with concrete values stripped.
 * Two executions of the same operation with different bound values share a fingerprint,
 * so the engine can flag them as an N+1 pattern.
 */
export function buildMongoFingerprint(entry: MongooseQueryEntry): string {
  const shape =
    entry.operation === 'aggregate' ? shapeOf(entry.pipeline ?? []) : shapeOf(entry.filter ?? {});
  return `${entry.operation} ${entry.collection} ${JSON.stringify(shape)}`;
}
