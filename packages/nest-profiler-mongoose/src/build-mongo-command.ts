import type { MongooseQueryEntry } from './mongoose-collector.interface';

/**
 * Builds a runnable `mongosh` command from a captured query, mirroring the
 * Symfony Web Profiler "copy query" feature:
 *
 * - aggregations → `db.<collection>.aggregate([<pipeline>])`
 * - everything else → `db.<collection>.<operation>(<filter>)`
 *
 * The argument is rendered as indented JSON so it pastes cleanly into a shell.
 */
export function buildMongoCommand(entry: MongooseQueryEntry): string {
  const target = `db.${entry.collection}`;

  if (entry.operation === 'aggregate') {
    const pipeline = entry.pipeline ?? [];
    return `${target}.aggregate(${JSON.stringify(pipeline, null, 2)})`;
  }

  const filter = entry.filter ?? {};
  return `${target}.${entry.operation}(${JSON.stringify(filter, null, 2)})`;
}
