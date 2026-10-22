import { toMermaidErDiagram } from './mermaid-er';
import type { ColumnInfo, EntitySchema, RelationInfo } from './schema.interface';

const column = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  type: 'int',
  nullable: false,
  primary: false,
  generated: false,
  ...over,
});

const entity = (
  name: string,
  relations: RelationInfo[] = [],
  over: Partial<EntitySchema> = {},
): EntitySchema => ({
  name,
  tableName: name.toLowerCase(),
  columns: [column('id', { primary: true })],
  relations,
  indexes: [],
  ...over,
});

/** The relation lines of a diagram (entity blocks stripped). */
const relationLines = (diagram: string): string[] =>
  diagram.split('\n').filter((line) => line.includes(' : '));

describe('toMermaidErDiagram', () => {
  it('renders each entity as a block of typed attributes with PK / UK keys', () => {
    const product = entity('Product', [], {
      columns: [
        column('id', { primary: true }),
        column('sku', { type: 'varchar', length: '64' }),
        column('price', { type: 'numeric(10,2)' }),
        column('createdAt', { type: 'timestamp with time zone' }),
      ],
      indexes: [
        { name: 'UQ_sku', columns: ['sku'], unique: true },
        { columns: ['price', 'createdAt'], unique: true },
      ],
    });

    expect(toMermaidErDiagram([product])).toBe(
      [
        'erDiagram',
        '  Product {',
        '    int id PK',
        '    varchar(64) sku UK',
        '    numeric(10,2) price',
        '    timestamp_with_time_zone createdAt',
        '  }',
      ].join('\n'),
    );
  });

  it('declares an entity without columns by its name alone', () => {
    expect(toMermaidErDiagram([entity('Tag', [], { columns: [] })])).toBe('erDiagram\n  Tag');
  });

  it('sanitizes names Mermaid would reject', () => {
    const diagram = toMermaidErDiagram([
      entity('2fa Code', [], { columns: [column('my field', { type: 'enum' })] }),
    ]);
    expect(diagram).toContain('  _2fa_Code {');
    expect(diagram).toContain('    enum my_field');
  });

  it('draws both sides of a bidirectional one-to-many as a single many-to-one line', () => {
    const diagram = toMermaidErDiagram([
      entity('Category', [
        {
          property: 'products',
          kind: 'one-to-many',
          target: 'Product',
          inverseProperty: 'category',
        },
      ]),
      entity('Product', [
        {
          property: 'category',
          kind: 'many-to-one',
          target: 'Category',
          inverseProperty: 'products',
        },
      ]),
    ]);
    expect(relationLines(diagram)).toEqual(['  Product }o--|| Category : "category / products"']);
  });

  it('pairs the two sides when only one of them names the inverse', () => {
    const diagram = toMermaidErDiagram([
      entity('Category', [
        {
          property: 'products',
          kind: 'one-to-many',
          target: 'Product',
          inverseProperty: 'category',
        },
      ]),
      entity('Product', [{ property: 'category', kind: 'many-to-one', target: 'Category' }]),
    ]);
    expect(relationLines(diagram)).toEqual(['  Product }o--|| Category : "category / products"']);
  });

  it('keeps distinct relations between the same two entities apart', () => {
    const diagram = toMermaidErDiagram([
      entity('User'),
      entity('Post', [
        { property: 'author', kind: 'many-to-one', target: 'User' },
        { property: 'editor', kind: 'many-to-one', target: 'User' },
      ]),
    ]);
    expect(relationLines(diagram)).toEqual([
      '  Post }o--|| User : "author"',
      '  Post }o--|| User : "editor"',
    ]);
  });

  it('orders symmetric relations so the owning and inverse sides collapse', () => {
    const diagram = toMermaidErDiagram([
      entity('Tag', [
        { property: 'posts', kind: 'many-to-many', target: 'Post', inverseProperty: 'tags' },
      ]),
      entity('Post', [
        { property: 'tags', kind: 'many-to-many', target: 'Tag', inverseProperty: 'posts' },
      ]),
      entity('User', [
        { property: 'mentor', kind: 'one-to-one', target: 'User', inverseProperty: 'mentee' },
        { property: 'mentee', kind: 'one-to-one', target: 'User', inverseProperty: 'mentor' },
      ]),
    ]);
    expect(relationLines(diagram)).toEqual([
      '  Post }o--o{ Tag : "tags / posts"',
      '  User |o--o| User : "mentee / mentor"',
    ]);
  });

  it('collapses a self-referencing tree into one line', () => {
    const diagram = toMermaidErDiagram([
      entity('Category', [
        {
          property: 'parent',
          kind: 'many-to-one',
          target: 'Category',
          inverseProperty: 'children',
        },
        {
          property: 'children',
          kind: 'one-to-many',
          target: 'Category',
          inverseProperty: 'parent',
        },
      ]),
    ]);
    expect(relationLines(diagram)).toEqual(['  Category }o--|| Category : "parent / children"']);
  });

  it('skips relation kinds outside the normalized cardinalities', () => {
    const diagram = toMermaidErDiagram([
      entity('Product', [{ property: 'dimensions', kind: 'embedded', target: 'Dimensions' }]),
    ]);
    expect(relationLines(diagram)).toEqual([]);
  });

  it('keeps double quotes out of the relation label', () => {
    const diagram = toMermaidErDiagram([
      entity('Post', [{ property: 'a"b', kind: 'many-to-one', target: 'User' }]),
    ]);
    expect(relationLines(diagram)).toEqual(['  Post }o--|| User : "a\'b"']);
  });
});
