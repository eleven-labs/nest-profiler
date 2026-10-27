import { toMermaidDocumentDiagram } from './mermaid-document.js';
import type { ColumnInfo, EntitySchema } from './schema.interface.js';

const field = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  type: 'String',
  nullable: true,
  primary: false,
  generated: false,
  ...over,
});

const model = (name: string, over: Partial<EntitySchema> = {}): EntitySchema => ({
  name,
  tableName: name.toLowerCase(),
  columns: [],
  relations: [],
  indexes: [],
  ...over,
});

describe('toMermaidDocumentDiagram', () => {
  it('nests embedded blocks, marks _id and unique fields, and dashes the references', () => {
    const diagram = toMermaidDocumentDiagram([
      model('User', {
        columns: [
          field('_id', { type: 'ObjectId', primary: true }),
          field('email', { nullable: false }),
          field('profile', { type: 'Subdocument', nullable: false, embedded: 'one' }),
          field('profile.avatar', { depth: 1 }),
          field('profile.links', { type: 'Subdocument[]', depth: 1, embedded: 'many' }),
          field('profile.links._id', { type: 'ObjectId', primary: true, depth: 2 }),
          field('profile.links.page', { type: 'ObjectId', depth: 2 }),
          field('settings', { type: 'Object', embedded: 'one' }),
          field('teams', { type: 'ObjectId[]' }),
        ],
        relations: [
          { property: 'profile.links.page', kind: 'ref', target: 'Page' },
          { property: 'teams', kind: 'ref[]', target: 'Team' },
        ],
        indexes: [
          { columns: ['email'], unique: true },
          { columns: ['email', 'teams'], unique: true },
        ],
      }),
    ]);

    expect(diagram).toBe(
      [
        'erDiagram',
        '  User {',
        '    ObjectId _id PK',
        '    String email UK',
        '    Subdocument profile',
        '    Object settings',
        '    ObjectId[] teams "ref Team"',
        '  }',
        '  User_profile["User.profile"] {',
        '    String avatar',
        '    Subdocument[] links',
        '  }',
        '  User_profile_links["User.profile.links[]"] {',
        // Only the document's own `_id` is a primary key.
        '    ObjectId _id',
        '    ObjectId page "ref Page"',
        '  }',
        '  User_settings["User.settings"]',
        '  User ||--|| User_profile : "embeds profile"',
        '  User_profile ||--o{ User_profile_links : "embeds links[]"',
        '  User ||--o| User_settings : "embeds settings"',
        '  User_profile_links }o..o| Page : "ref page"',
        '  User }o..o{ Team : "ref teams[]"',
      ].join('\n'),
    );
  });

  it('draws a model without fields as a bare block', () => {
    expect(toMermaidDocumentDiagram([model('Tag')])).toBe('erDiagram\n  Tag');
  });

  it('keeps an embedded block id clear of a model with the same name', () => {
    const diagram = toMermaidDocumentDiagram([
      model('Order', {
        columns: [field('items', { type: 'Subdocument[]', embedded: 'many' })],
      }),
      model('Order_items'),
    ]);

    expect(diagram).toContain('  Order_items_2["Order.items[]"]');
    expect(diagram).toContain('  Order ||--o{ Order_items_2 : "embeds items[]"');
  });

  it('starts a reference with no matching field from the model itself', () => {
    const diagram = toMermaidDocumentDiagram([
      model('Post', { relations: [{ property: 'author', kind: 'ref', target: 'User' }] }),
    ]);

    expect(diagram).toContain('  Post }o..o| User : "ref author"');
  });

  it('reads a field nested deeper than its parent as the parent’s last block', () => {
    const diagram = toMermaidDocumentDiagram([
      model('Post', { columns: [field('title'), field('stray', { depth: 3 })] }),
    ]);

    expect(diagram).toBe('erDiagram\n  Post {\n    String title\n    String stray\n  }');
  });

  it('keeps quotes out of the labels', () => {
    const diagram = toMermaidDocumentDiagram([
      model('Post', { relations: [{ property: 'by', kind: 'ref', target: 'Us"er' }] }),
    ]);

    expect(diagram).toContain(`Us_er : "ref by"`);
  });
});
