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
});
