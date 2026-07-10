import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { ModuleRef } from '@nestjs/core';
import type { Connection } from 'mongoose';
import type { Profile } from '@eleven-labs/nest-profiler';
import { MongooseSchemaCollector } from './mongoose-schema.collector';

const emptyProfile = {} as Profile;

/** Fake mongoose Model built from a `paths` map + declared schema indexes. */
function fakeModel(
  modelName: string,
  collectionName: string,
  paths: Record<string, unknown>,
  indexes: Array<[Record<string, number>, Record<string, unknown>]> = [],
): unknown {
  return {
    modelName,
    collection: { name: collectionName },
    schema: { paths, indexes: () => indexes },
  };
}

function fakeConnection(models: Record<string, unknown>): Connection {
  return { models } as unknown as Connection;
}

/** ModuleRef returning `connection` for the (optionally named) connection token, else undefined. */
function moduleRefFor(connection: Connection | undefined, connectionName?: string): ModuleRef {
  const token = getConnectionToken(connectionName);
  return { get: (t: unknown) => (t === token ? connection : undefined) } as unknown as ModuleRef;
}

const reviewModel = fakeModel(
  'Review',
  'reviews',
  {
    _id: { instance: 'ObjectID', isRequired: false, options: {} },
    body: { instance: 'String', isRequired: true, options: {} },
    source: {
      instance: 'String',
      isRequired: false,
      options: { default: 'sk-0123456789abcdefghij' },
    },
    author: { instance: 'ObjectID', isRequired: true, options: { ref: 'User' } },
    tags: { instance: 'Array', options: {}, caster: { options: { ref: 'Tag' } } },
  },
  [[{ body: 1 }, { name: 'body_text', unique: true }]],
);

describe('MongooseSchemaCollector', () => {
  it('introspects registered models into the normalized shape', () => {
    const collector = new MongooseSchemaCollector(
      moduleRefFor(fakeConnection({ Review: reviewModel })),
    );
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entityCount).toBe(1);
    const review = data.entities[0];
    expect(review).toMatchObject({ name: 'Review', tableName: 'reviews' });
    // `_id` is the primary key; `author`/`tags` are refs → relations, not columns.
    expect(review?.columns.map((c) => c.name)).toEqual(['_id', 'body', 'source']);
    expect(review?.columns[0]).toMatchObject({ name: '_id', primary: true, generated: true });
    expect(review?.columns[1]).toMatchObject({ name: 'body', type: 'String', nullable: false });
    expect(review?.relations).toEqual([
      { property: 'author', kind: 'many-to-one', target: 'User' },
      { property: 'tags', kind: 'one-to-many', target: 'Tag' },
    ]);
    expect(review?.indexes).toEqual([{ name: 'body_text', columns: ['body'], unique: true }]);
  });

  it('redacts secrets embedded in path defaults', () => {
    const collector = new MongooseSchemaCollector(
      moduleRefFor(fakeConnection({ Review: reviewModel })),
    );
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    const source = data.entities[0]?.columns.find((c) => c.name === 'source');
    expect(source?.default).toBe('[REDACTED]');
  });

  it('no-ops (no panel, no warning) when the connection is absent', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new MongooseSchemaCollector(moduleRefFor(undefined));
    collector.onApplicationBootstrap();

    expect(collector.collect(emptyProfile).entityCount).toBe(0);
    expect(collector.getBadgeValue(emptyProfile)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns (canary) when the connection is present but registers no models', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new MongooseSchemaCollector(moduleRefFor(fakeConnection({})));
    collector.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('honours connectionName — resolves the named connection token', () => {
    const collector = new MongooseSchemaCollector(
      moduleRefFor(fakeConnection({ Review: reviewModel }), 'analytics'),
      { connectionName: 'analytics' },
    );
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(1);
  });

  it('no-ops when the named connection is absent', () => {
    const collector = new MongooseSchemaCollector(
      moduleRefFor(fakeConnection({ Review: reviewModel })),
      { connectionName: 'analytics' },
    );
    collector.onApplicationBootstrap();
    expect(collector.collect(emptyProfile).entityCount).toBe(0);
  });

  it('stringifies every field default shape and falls back to Mixed / ignores non-string refs', () => {
    const model = fakeModel(
      'Variant',
      'variants',
      {
        n: { instance: 'Number', options: { default: 0 } },
        b: { instance: 'Boolean', options: { default: false } },
        big: { instance: 'Number', options: { default: 10n } },
        fn: { instance: 'Date', options: { default: () => new Date() } },
        obj: { instance: 'Mixed', options: { default: { a: 1 } } },
        untyped: { options: {} }, // no `instance` → "Mixed"
        weakRef: { instance: 'String', options: { ref: 123 } }, // non-string ref → a column, not a relation
        // Array-of-refs: the element `ref` lives under caster / embeddedSchemaType / $embeddedSchemaType
        // depending on the mongoose version — each must be detected as a relation.
        casterTags: { instance: 'Array', caster: { options: { ref: 'CasterTag' } } },
        embeddedTags: {
          instance: 'Array',
          embeddedSchemaType: { options: { ref: 'EmbeddedTag' } },
        },
        legacyTags: { instance: 'Array', $embeddedSchemaType: { options: { ref: 'LegacyTag' } } },
      },
      [[{ n: 1 }, {}]], // index without a declared name → name undefined, non-unique
    );
    const collector = new MongooseSchemaCollector(moduleRefFor(fakeConnection({ Variant: model })));
    collector.onApplicationBootstrap();

    const entity = collector.collect(emptyProfile).entities[0];
    const col = (name: string): { type: string; default?: string } | undefined =>
      entity?.columns.find((c) => c.name === name);
    expect(col('n')?.default).toBe('0');
    expect(col('b')?.default).toBe('false');
    expect(col('big')?.default).toBe('10');
    expect(col('fn')?.default).toBe('() => …');
    expect(col('obj')?.default).toBe('{"a":1}');
    expect(col('untyped')?.type).toBe('Mixed');
    expect(col('weakRef')).toBeDefined(); // non-string ref stays a column
    // Array-of-refs resolves the target from whichever element holder the mongoose version uses.
    expect(entity?.relations).toEqual([
      { property: 'casterTags', kind: 'one-to-many', target: 'CasterTag' },
      { property: 'embeddedTags', kind: 'one-to-many', target: 'EmbeddedTag' },
      { property: 'legacyTags', kind: 'one-to-many', target: 'LegacyTag' },
    ]);
    expect(entity?.indexes).toEqual([{ name: undefined, columns: ['n'], unique: false }]);
  });
});
