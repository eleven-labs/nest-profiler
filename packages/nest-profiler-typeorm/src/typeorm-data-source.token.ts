import { DataSource } from 'typeorm';

const DEFAULT_DATA_SOURCE_NAME = 'default';

/**
 * The injection token `TypeOrmModule` registers a DataSource under — the same value as
 * `getDataSourceToken()` from `@nestjs/typeorm`: the `DataSource` class for the default
 * connection, `<name>DataSource` for a named one.
 *
 * It is computed here rather than imported because `@nestjs/typeorm` is ESM-only since v12, and
 * a value import of it would break `require()` of this CommonJS package.
 */
export function getDataSourceToken(
  connectionName: string = DEFAULT_DATA_SOURCE_NAME,
): typeof DataSource | string {
  return connectionName === DEFAULT_DATA_SOURCE_NAME ? DataSource : `${connectionName}DataSource`;
}
