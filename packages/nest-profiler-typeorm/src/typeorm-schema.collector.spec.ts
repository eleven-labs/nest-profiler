import { Logger } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import type { Profile } from '@eleven-labs/nest-profiler';
import { TypeOrmSchemaCollector } from './typeorm-schema.collector';

const emptyProfile = {} as Profile;

/** Minimal `EntityMetadata` fixture — only the fields the collector reads. */
function fakeDataSource(entityMetadatas: unknown[], isInitialized = true): DataSource {
  return { isInitialized, entityMetadatas } as unknown as DataSource;
}

/** ModuleRef that returns `dataSource` for the (optionally named) DataSource token, else undefined. */
function moduleRefFor(dataSource: DataSource | undefined, connectionName?: string): ModuleRef {
  const token = getDataSourceToken(connectionName);
  return { get: (t: unknown) => (t === token ? dataSource : undefined) } as unknown as ModuleRef;
}

const productMetadata = {
  name: 'Product',
  tableName: 'products',
  columns: [
    {
      propertyName: 'id',
      databaseName: 'id',
      type: 'int',
      isNullable: false,
      isPrimary: true,
      isGenerated: true,
      default: undefined,
      length: '',
    },
    {
      propertyName: 'name',
      databaseName: 'name',
      type: 'varchar',
      isNullable: false,
      isPrimary: false,
      isGenerated: false,
      default: undefined,
      length: '255',
    },
    {
      propertyName: 'dsn',
      databaseName: 'dsn',
      type: 'varchar',
      isNullable: true,
      isPrimary: false,
      isGenerated: false,
      default: 'postgres://admin:s3cr3t@db:5432/app',
      length: '',
    },
  ],
  relations: [
    {
      propertyName: 'reviews',
      relationType: 'one-to-many',
      inverseEntityMetadata: { name: 'Review' },
    },
  ],
  indices: [{ name: 'IDX_name', columns: [{ propertyName: 'name' }], isUnique: true }],
};

describe('TypeOrmSchemaCollector', () => {
  it('introspects registered entities into the normalized shape', () => {
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([productMetadata])));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entityCount).toBe(1);
    const product = data.entities[0];
    expect(product).toMatchObject({ name: 'Product', tableName: 'products' });
    expect(product?.columns).toHaveLength(3);
    expect(product?.columns[0]).toMatchObject({
      name: 'id',
      type: 'int',
      primary: true,
      generated: true,
    });
    expect(product?.columns[1]).toMatchObject({
      name: 'name',
      type: 'varchar',
      length: '255',
      nullable: false,
    });
    expect(product?.relations).toEqual([
      { property: 'reviews', kind: 'one-to-many', target: 'Review' },
    ]);
    expect(product?.indexes).toEqual([{ name: 'IDX_name', columns: ['name'], unique: true }]);
  });

  it('redacts secrets embedded in column defaults', () => {
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([productMetadata])));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    const dsn = data.entities[0]?.columns.find((c) => c.name === 'dsn');
    expect(dsn?.default).toBe('postgres://[REDACTED]@db:5432/app');
  });

  it('reports the entity count as the badge value', () => {
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([productMetadata])));
    collector.onApplicationBootstrap();
    expect(collector.getBadgeValue(emptyProfile)).toBe('1');
  });

  it('no-ops (no panel, no warning) when the DataSource is absent', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new TypeOrmSchemaCollector(moduleRefFor(undefined));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entityCount).toBe(0);
    expect(collector.getBadgeValue(emptyProfile)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('no-ops when the DataSource is not initialized', () => {
    const collector = new TypeOrmSchemaCollector(
      moduleRefFor(fakeDataSource([productMetadata], false)),
    );
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(0);
  });

  it('warns (canary) when the DataSource is present but exposes no entities', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([])));
    collector.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('honours connectionName — resolves the named DataSource token', () => {
    const collector = new TypeOrmSchemaCollector(
      moduleRefFor(fakeDataSource([productMetadata]), 'analytics'),
      { connectionName: 'analytics' },
    );
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(1);
  });

  it('no-ops when the named DataSource is absent', () => {
    // ModuleRef only knows the default token; the collector asks for 'analytics'.
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([productMetadata])), {
      connectionName: 'analytics',
    });
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(0);
  });

  it('stringifies column type (constructor form) and every default shape', () => {
    const column = (over: Record<string, unknown>): Record<string, unknown> => ({
      databaseName: over.propertyName,
      isNullable: false,
      isPrimary: false,
      isGenerated: false,
      length: '',
      ...over,
    });
    const variant = {
      name: 'Variant',
      tableName: 'variants',
      columns: [
        // `type` as a constructor function → its `.name`.
        column({ propertyName: 'count', type: Number, default: 0 }),
        column({ propertyName: 'active', type: 'boolean', default: true }),
        column({ propertyName: 'ratio', type: 'bigint', default: 10n }),
        column({ propertyName: 'createdAt', type: 'timestamp', default: () => 'now()' }),
        column({ propertyName: 'meta', type: 'jsonb', default: { a: 1 } }),
      ],
      relations: [],
      indices: [],
    };
    const collector = new TypeOrmSchemaCollector(moduleRefFor(fakeDataSource([variant])));
    collector.onApplicationBootstrap();

    const columns = collector.collect(emptyProfile).entities[0]?.columns ?? [];
    const col = (name: string): { type: string; default?: string } | undefined =>
      columns.find((c) => c.name === name);
    expect(col('count')).toMatchObject({ type: 'Number', default: '0' });
    expect(col('active')?.default).toBe('true');
    expect(col('ratio')?.default).toBe('10');
    expect(col('createdAt')?.default).toBe('() => …');
    expect(col('meta')?.default).toBe('{"a":1}');
  });
});
