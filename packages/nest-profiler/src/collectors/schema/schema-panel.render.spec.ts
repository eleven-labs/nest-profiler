import * as path from 'node:path';
import { ClientAssetRegistry } from '../../services/client-asset-registry.service.js';
import { TemplateRendererService } from '../../services/template-renderer.service.js';
import type { SchemaCollectorData } from './schema.interface.js';

const SCHEMA_PANEL = path.join(__dirname, 'templates', 'schema-panel.ejs');

function render(data: SchemaCollectorData): Promise<string> {
  const service = new TemplateRendererService(new ClientAssetRegistry());
  return service.render('list', {
    title: 'Profiles',
    profilerPath: '/_profiler',
    clientScripts: ['profiler.js'],
    profiles: [],
    sectionViews: [{ key: 'http', label: 'HTTP', count: 0 }],
    globalViewGroups: [
      { label: 'Schemas', views: [{ key: 'typeorm-schema', label: 'TypeORM', count: 1 }] },
    ],
    activeView: 'typeorm-schema',
    activeGlobalPanel: {
      name: 'typeorm-schema',
      label: 'TypeORM',
      groupLabel: 'Schemas',
      templatePath: SCHEMA_PANEL,
      data,
    },
    filters: {},
  });
}

const product = {
  name: 'Product',
  tableName: 'products',
  columns: [{ name: 'id', type: 'int', nullable: false, primary: true, generated: true }],
  relations: [],
  indexes: [],
};

describe('schema-panel template', () => {
  it('omits the diagram section when the collector provides no Mermaid source', async () => {
    const html = await render({ entities: [product], entityCount: 1 });
    expect(html).not.toContain('data-mermaid-diagram');
  });

  it('renders a closed diagram section carrying the escaped source and a copy button', async () => {
    const mermaid = 'erDiagram\n  Post }o--|| User : "<script>alert(1)</script>"';
    const html = await render({ entities: [product], entityCount: 1, mermaid });

    expect(html).toMatch(/<details[^>]*data-mermaid-diagram>/);
    expect(html).not.toMatch(/<details[^>]*data-mermaid-diagram[^>]*\sopen/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain(`data-copy="${Buffer.from(mermaid, 'utf8').toString('base64')}"`);
  });

  it('draws the diagram into a pan/zoom viewport with its controls and an entity picker', async () => {
    const html = await render({ entities: [product], entityCount: 1, mermaid: 'erDiagram' });

    expect(html).toMatch(/<div[^>]*tabindex="0"[^>]*data-diagram-viewport>/);
    for (const action of ['zoom-out', 'actual', 'zoom-in', 'fit', 'expand']) {
      expect(html).toContain(`data-diagram-action="${action}"`);
    }
    expect(html).toContain('data-mermaid-entities');
  });

  it('speaks of tables, columns and relations for a relational schema', async () => {
    const html = await render({ entities: [product], entityCount: 1, mermaid: 'erDiagram' });

    expect(html).toContain('Registered entities');
    expect(html).toContain('Entity relationship diagram');
    expect(html).toContain('1 column<');
    expect(html).toContain('>Nullable<');
  });

  describe('document schema', () => {
    const order = {
      name: 'Order',
      tableName: 'orders',
      columns: [
        { name: 'customer', type: 'ObjectId', nullable: false, primary: false, generated: false },
        {
          name: 'items',
          type: 'Subdocument[]',
          nullable: true,
          primary: false,
          generated: false,
          embedded: 'many' as const,
        },
        {
          name: 'items.qty',
          type: 'Number',
          nullable: true,
          primary: false,
          generated: false,
          depth: 1,
        },
      ],
      relations: [{ property: 'customer', kind: 'ref', target: 'Customer' }],
      indexes: [],
    };
    const renderDocument = (): Promise<string> =>
      render({ entities: [order], entityCount: 1, dataModel: 'document', mermaid: 'erDiagram' });

    it('speaks of models, fields and references', async () => {
      const html = await renderDocument();

      expect(html).toContain('Registered models');
      expect(html).toContain('Document diagram');
      expect(html).toContain('Go to model…');
      expect(html).toContain('3 fields');
      expect(html).toContain('>Fields<');
      expect(html).toContain('>References<');
      expect(html).not.toContain('Entity relationship diagram');
      expect(html).not.toContain('>Relations<');
    });

    it('shows whether a field is required rather than nullable', async () => {
      const html = await renderDocument();
      const rows = html.split('<tr').filter((row) => row.includes('ObjectId'));

      expect(html).toContain('>Required<');
      expect(html).not.toContain('>Nullable<');
      expect(rows[0]).toMatch(/font-mono">yes</);
    });

    it('indents the fields of an embedded document under the field holding it', async () => {
      const html = await renderDocument();

      expect(html).toMatch(
        /style="padding-left: 2\.25rem" title="items\.qty">\s*<span[^>]*>↳<\/span>\s*<span[^>]*>qty</,
      );
    });
  });
});
