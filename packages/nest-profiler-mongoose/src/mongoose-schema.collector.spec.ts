import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { ModuleRef } from '@nestjs/core';
import { Mongoose, Schema } from 'mongoose';
import type { Connection } from 'mongoose';
import type { Profile } from '@eleven-labs/nest-profiler';
import { MongooseSchemaCollector } from './mongoose-schema.collector.js';

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
    expect(data.dataModel).toBe('document');
    const review = data.entities[0];
    expect(review).toMatchObject({ name: 'Review', tableName: 'reviews' });
    // `_id` is the primary key; a ref is a stored id — a field — and a reference to its model.
    expect(review?.columns.map((c) => c.name)).toEqual(['_id', 'body', 'source', 'author', 'tags']);
    expect(review?.columns[0]).toMatchObject({ name: '_id', primary: true, generated: true });
    expect(review?.columns[1]).toMatchObject({ name: 'body', type: 'String', nullable: false });
    expect(review?.relations).toEqual([
      { property: 'author', kind: 'ref', target: 'User' },
      { property: 'tags', kind: 'ref[]', target: 'Tag' },
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
      { property: 'casterTags', kind: 'ref[]', target: 'CasterTag' },
      { property: 'embeddedTags', kind: 'ref[]', target: 'EmbeddedTag' },
      { property: 'legacyTags', kind: 'ref[]', target: 'LegacyTag' },
    ]);
    expect(entity?.indexes).toEqual([{ name: undefined, columns: ['n'], unique: false }]);
  });

  describe('document structure, introspected from real mongoose schemas', () => {
    /** Registers `schemas` as models on a fresh Mongoose instance and collects the panel data. */
    function collectModels(
      schemas: Record<string, Schema>,
    ): ReturnType<MongooseSchemaCollector['collect']> {
      const mongoose = new Mongoose();
      for (const [name, schema] of Object.entries(schemas)) mongoose.model(name, schema);
      const collector = new MongooseSchemaCollector(moduleRefFor(fakeConnection(mongoose.models)));
      collector.onApplicationBootstrap();
      return collector.collect(emptyProfile);
    }

    const item = new Schema({
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
      qty: Number,
    });
    const address = new Schema({ city: String }, { _id: false });
    const order = new Schema({
      customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
      tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
      items: [item],
      shipping: { type: address, required: true },
      meta: { source: String, nested: { deep: Number } },
      labels: [String],
    });
    order.index({ 'items.product': 1 });

    it('lists embedded documents and nested objects parent-first, one level deeper', () => {
      const data = collectModels({ Order: order });
      const fields = data.entities[0]?.columns.map(({ name, type, depth, embedded }) => ({
        name,
        type,
        depth,
        embedded,
      }));

      expect(fields).toEqual([
        { name: 'customer', type: 'ObjectId', depth: undefined, embedded: undefined },
        { name: 'tags', type: 'ObjectId[]', depth: undefined, embedded: undefined },
        { name: 'items', type: 'Subdocument[]', depth: undefined, embedded: 'many' },
        { name: 'items.product', type: 'ObjectId', depth: 1, embedded: undefined },
        { name: 'items.qty', type: 'Number', depth: 1, embedded: undefined },
        { name: 'items._id', type: 'ObjectId', depth: 1, embedded: undefined },
        { name: 'shipping', type: 'Subdocument', depth: undefined, embedded: 'one' },
        { name: 'shipping.city', type: 'String', depth: 1, embedded: undefined },
        { name: 'meta', type: 'Object', depth: undefined, embedded: 'one' },
        { name: 'meta.source', type: 'String', depth: 1, embedded: undefined },
        { name: 'meta.nested', type: 'Object', depth: 1, embedded: 'one' },
        { name: 'meta.nested.deep', type: 'Number', depth: 2, embedded: undefined },
        { name: 'labels', type: 'String[]', depth: undefined, embedded: undefined },
        { name: '_id', type: 'ObjectId', depth: undefined, embedded: undefined },
        { name: '__v', type: 'Number', depth: undefined, embedded: undefined },
      ]);
      const column = (name: string) => data.entities[0]?.columns.find((c) => c.name === name);
      // Only the document's own `_id` is its primary key; an embedded `_id` is generated too.
      expect(column('_id')).toMatchObject({ primary: true, generated: true });
      expect(column('items._id')).toMatchObject({ primary: false, generated: true });
      expect(column('shipping')?.nullable).toBe(false);
    });

    it('finds the references nested in embedded documents', () => {
      const data = collectModels({ Order: order });

      expect(data.entities[0]?.relations).toEqual([
        { property: 'customer', kind: 'ref', target: 'Customer' },
        { property: 'tags', kind: 'ref[]', target: 'Tag' },
        { property: 'items.product', kind: 'ref', target: 'Product' },
      ]);
      expect(data.entities[0]?.indexes).toEqual([
        { name: undefined, columns: ['items.product'], unique: false },
      ]);
    });

    it('draws a document diagram: embedding solid, references dashed', () => {
      const data = collectModels({
        Order: order,
        Product: new Schema({ sku: { type: String, unique: true } }),
      });

      expect(data.mermaid).toBe(
        [
          'erDiagram',
          '  Order {',
          '    ObjectId customer "ref Customer"',
          '    ObjectId[] tags "ref Tag"',
          '    Subdocument[] items',
          '    Subdocument shipping',
          '    Object meta',
          '    String[] labels',
          '    ObjectId _id PK',
          '    Number __v',
          '  }',
          '  Order_items["Order.items[]"] {',
          '    ObjectId product "ref Product"',
          '    Number qty',
          '    ObjectId _id',
          '  }',
          '  Order_shipping["Order.shipping"] {',
          '    String city',
          '  }',
          '  Order_meta["Order.meta"] {',
          '    String source',
          '    Object nested',
          '  }',
          '  Order_meta_nested["Order.meta.nested"] {',
          '    Number deep',
          '  }',
          '  Product {',
          '    String sku UK',
          '    ObjectId _id PK',
          '    Number __v',
          '  }',
          '  Order ||--o{ Order_items : "embeds items[]"',
          '  Order ||--|| Order_shipping : "embeds shipping"',
          '  Order ||--o| Order_meta : "embeds meta"',
          '  Order_meta ||--o| Order_meta_nested : "embeds nested"',
          '  Order }o..o| Customer : "ref customer"',
          '  Order }o..o{ Tag : "ref tags[]"',
          '  Order_items }o..o| Product : "ref product"',
        ].join('\n'),
      );
    });

    it('recognises the same embedded shape wherever it is used', () => {
      const address = (): Schema =>
        new Schema(
          { city: { type: String, required: true }, geo: { lat: Number } },
          { _id: false },
        );
      const shared = address();
      const data = collectModels({
        Order: new Schema({
          shipping: { type: shared, required: true },
          billing: shared,
          // A distinct but identical schema — what `@nestjs/mongoose` builds per `@Prop`.
          pickup: address(),
          parcel: new Schema({ weight: Number }),
        }),
        Customer: new Schema({ addresses: [shared] }),
      });
      const shape = (model: number, name: string): string | undefined =>
        data.entities[model]?.columns.find((c) => c.name === name)?.embeddedShape;

      expect(shape(0, 'shipping')).toEqual(expect.any(String));
      expect(shape(0, 'billing')).toBe(shape(0, 'shipping'));
      expect(shape(0, 'pickup')).toBe(shape(0, 'shipping'));
      // One document or an array of them: the same shape.
      expect(shape(1, 'addresses')).toBe(shape(0, 'shipping'));
      expect(shape(0, 'parcel')).not.toBe(shape(0, 'shipping'));
      // A plain nested object belongs to its field: never shared.
      expect(shape(0, 'shipping.geo')).toBeUndefined();

      expect(data.mermaid).toContain(
        '  Order_shipping["shipping / billing / pickup / addresses"] {',
      );
      expect(data.mermaid).toContain('  Customer ||--o{ Order_shipping : "embeds addresses[]"');
      expect(data.mermaid).not.toContain('Order_billing');
    });

    it('does not expand a recursive schema forever', () => {
      const comment = new Schema({ body: String });
      comment.add({ replies: [comment] });

      const data = collectModels({ Thread: new Schema({ comments: [comment] }) });
      const names = data.entities[0]?.columns.map((c) => c.name);

      expect(names).toContain('comments.replies');
      expect(names).not.toContain('comments.replies.body');
    });
  });
});
