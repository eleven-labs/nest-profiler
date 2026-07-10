import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Profile } from '@eleven-labs/nest-profiler';

// MikroORM v7 is ESM-only; the collector imports `MikroORM` (a runtime DI token) and
// `ReferenceKind` (an enum used to classify props). Stub both so the CJS test can load it.
jest.mock('@mikro-orm/core', () => ({
  MikroORM: class MikroORM {},
  ReferenceKind: {
    SCALAR: 'scalar',
    ONE_TO_ONE: '1:1',
    ONE_TO_MANY: '1:m',
    MANY_TO_ONE: 'm:1',
    MANY_TO_MANY: 'm:n',
    EMBEDDED: 'embedded',
  },
}));
jest.mock('@mikro-orm/nestjs', () => ({ getMikroORMToken: (name: string) => `MikroORM_${name}` }));

import { MikroORM, ReferenceKind } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import { MikroOrmSchemaCollector } from './mikro-orm-schema.collector.js';

const emptyProfile = {} as Profile;

/** Fake MikroORM whose metadata storage returns the provided entities as a Map (v7 shape). */
function fakeOrm(metadatas: unknown[]): MikroORM {
  const byName = new Map(metadatas.map((m) => [(m as { className: string }).className, m]));
  return {
    getMetadata: () => ({ getAll: () => byName }),
  } as unknown as MikroORM;
}

/** ModuleRef that returns `orm` for the (optionally named) MikroORM token, else undefined. */
function moduleRefFor(orm: MikroORM | undefined, connectionName?: string): ModuleRef {
  const token = connectionName ? getMikroORMToken(connectionName) : MikroORM;
  return { get: (t: unknown) => (t === token ? orm : undefined) } as unknown as ModuleRef;
}

const productMetadata = {
  className: 'Product',
  tableName: 'products',
  abstract: false,
  props: [
    {
      name: 'id',
      kind: ReferenceKind.SCALAR,
      fieldNames: ['id'],
      columnTypes: ['int'],
      primary: true,
      autoincrement: true,
      nullable: false,
    },
    {
      name: 'name',
      kind: ReferenceKind.SCALAR,
      fieldNames: ['name'],
      columnTypes: ['varchar(255)'],
      nullable: false,
      length: 255,
    },
    {
      name: 'dsn',
      kind: ReferenceKind.SCALAR,
      fieldNames: ['dsn'],
      columnTypes: ['varchar'],
      nullable: true,
      default: 'postgres://admin:s3cr3t@db:5432/app',
    },
    { name: 'reviews', kind: ReferenceKind.ONE_TO_MANY },
  ],
  relations: [
    { name: 'reviews', kind: ReferenceKind.ONE_TO_MANY, targetMeta: { className: 'Review' } },
  ],
  indexes: [{ name: 'IDX_name', properties: 'name' }],
  uniques: [{ name: 'UQ_sku', properties: ['sku'] }],
};

describe('MikroOrmSchemaCollector', () => {
  it('introspects registered entities into the normalized shape', () => {
    const collector = new MikroOrmSchemaCollector(moduleRefFor(fakeOrm([productMetadata])));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entityCount).toBe(1);
    const product = data.entities[0];
    expect(product).toMatchObject({ name: 'Product', tableName: 'products' });
    // Only scalar props become columns; the relation prop is excluded.
    expect(product?.columns.map((c) => c.name)).toEqual(['id', 'name', 'dsn']);
    expect(product?.columns[0]).toMatchObject({
      name: 'id',
      type: 'int',
      primary: true,
      generated: true,
    });
    expect(product?.columns[1]).toMatchObject({
      name: 'name',
      type: 'varchar(255)',
      length: '255',
    });
    expect(product?.relations).toEqual([
      { property: 'reviews', kind: 'one-to-many', target: 'Review' },
    ]);
    expect(product?.indexes).toEqual([
      { name: 'IDX_name', columns: ['name'], unique: false },
      { name: 'UQ_sku', columns: ['sku'], unique: true },
    ]);
  });

  it('redacts secrets embedded in column defaults', () => {
    const collector = new MikroOrmSchemaCollector(moduleRefFor(fakeOrm([productMetadata])));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    const dsn = data.entities[0]?.columns.find((c) => c.name === 'dsn');
    expect(dsn?.default).toBe('postgres://[REDACTED]@db:5432/app');
  });

  it('no-ops (no panel, no warning) when the ORM is absent', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new MikroOrmSchemaCollector(moduleRefFor(undefined));
    collector.onApplicationBootstrap();

    expect(collector.collect(emptyProfile).entityCount).toBe(0);
    expect(collector.getBadgeValue(emptyProfile)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns (canary) when the ORM is present but exposes no entities', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new MikroOrmSchemaCollector(moduleRefFor(fakeOrm([])));
    collector.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('honours connectionName — resolves the named context token', () => {
    const collector = new MikroOrmSchemaCollector(
      moduleRefFor(fakeOrm([productMetadata]), 'analytics'),
      { connectionName: 'analytics' },
    );
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(1);
  });

  it('no-ops when the named context is absent', () => {
    const collector = new MikroOrmSchemaCollector(moduleRefFor(fakeOrm([productMetadata])), {
      connectionName: 'analytics',
    });
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(0);
  });

  it('covers type/default fallbacks, unknown relation kinds, table-name fallback and abstract entities', () => {
    const variant = {
      className: 'Variant',
      // No `tableName` → falls back to `collection`.
      collection: 'variants',
      abstract: false,
      props: [
        // No `columnTypes` → `propType` uses `type`: a plain string, then a constructor.
        { name: 'sku', kind: ReferenceKind.SCALAR, type: 'text' },
        { name: 'when', kind: ReferenceKind.SCALAR, type: Date },
        // `generated` (not `autoincrement`) still marks the column generated.
        { name: 'uid', kind: ReferenceKind.SCALAR, columnTypes: ['uuid'], generated: true },
        // `defaultRaw` feeds the default when `default` is absent; an explicit null yields none.
        { name: 'seq', kind: ReferenceKind.SCALAR, columnTypes: ['int'], defaultRaw: '0' },
        { name: 'opt', kind: ReferenceKind.SCALAR, columnTypes: ['int'], default: null },
      ],
      // Unknown relation kind → passed through as-is; no `targetMeta` → target from `type`.
      relations: [{ name: 'meta', kind: ReferenceKind.EMBEDDED, type: 'MetaValue' }],
      indexes: [],
      uniques: [],
    };
    // No `tableName` and no `collection` → falls back to `className`.
    const bare = {
      className: 'Bare',
      abstract: false,
      props: [],
      relations: [],
      indexes: [],
      uniques: [],
    };
    // Abstract base classes are excluded from the panel.
    const base = {
      className: 'Base',
      abstract: true,
      props: [],
      relations: [],
      indexes: [],
      uniques: [],
    };

    const collector = new MikroOrmSchemaCollector(moduleRefFor(fakeOrm([variant, bare, base])));
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entities.map((e) => e.name)).toEqual(['Variant', 'Bare']); // Base filtered out
    const entity = data.entities[0];
    expect(entity?.tableName).toBe('variants');
    const col = (
      name: string,
    ): { type: string; default?: string; generated: boolean } | undefined =>
      entity?.columns.find((c) => c.name === name);
    expect(col('sku')).toMatchObject({ type: 'text' });
    expect(col('when')?.type).toBe('Date');
    expect(col('uid')?.generated).toBe(true);
    expect(col('seq')?.default).toBe('0');
    expect(col('opt')?.default).toBeUndefined();
    expect(entity?.relations).toEqual([
      { property: 'meta', kind: 'embedded', target: 'MetaValue' },
    ]);
    expect(data.entities[1]?.tableName).toBe('Bare');
  });
});
