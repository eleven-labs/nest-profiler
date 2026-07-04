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
