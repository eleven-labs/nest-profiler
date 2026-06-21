/**
 * Formats a single bound parameter as a SQL literal.
 *
 * - `null`/`undefined` → `NULL`
 * - `number`/`bigint`  → as-is
 * - `boolean`          → `TRUE`/`FALSE`
 * - `Date`             → quoted ISO string
 * - `Buffer`/bytes     → `X'<hex>'`
 * - `string`           → single-quoted, `'` doubled
 * - object/array       → quoted JSON string
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

/**
 * Inlines bound parameters into a SQL string, producing a runnable query in the
 * spirit of the Symfony Web Profiler. Supports both placeholder dialects:
 *
 * - `$N` indexed placeholders (Postgres / TypeORM) → replaced by `parameters[N-1]`.
 * - `?` positional placeholders (MySQL / MikroORM) → replaced in order.
 *
 * Known limitation: `?`/`$N` occurring inside string literals are not detected,
 * but ORMs bind such values as parameters rather than emitting them inline.
 */
export function interpolateSql(sql: string, parameters?: unknown[]): string {
  if (!parameters || parameters.length === 0) return sql;

  if (/\$\d+/.test(sql)) {
    return sql.replace(/\$(\d+)/g, (match, index: string) => {
      const i = Number(index) - 1;
      return i >= 0 && i < parameters.length ? formatValue(parameters[i]) : match;
    });
  }

  let i = 0;
  return sql.replace(/\?/g, (match) =>
    i < parameters.length ? formatValue(parameters[i++]) : match,
  );
}
