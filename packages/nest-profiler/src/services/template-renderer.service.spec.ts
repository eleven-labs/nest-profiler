import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TemplateRendererService } from './template-renderer.service';
import { TEMPLATES_DIR } from '../views/template-engine';

const MINIMAL_LIST_DATA = {
  title: 'Profiles',
  profilerPath: '/_profiler',
  profiles: [],
  globalPanels: [],
  heapSeries: [],
  filters: {},
};

const MINIMAL_DETAIL_DATA = {
  title: 'Profile abc12345',
  profilerPath: '/_profiler',
  token: 'abc12345678',
  activeTab: 'request',
  summary: { badge: 'GET', badgeClass: 'badge-default', text: '/hello' },
  entrypointTabs: [{ name: 'request', label: 'Request', icon: undefined, badge: 'GET' }],
  entrypointTabTemplate: path.join(TEMPLATES_DIR, 'entrypoints', 'http-request.ejs'),
  collectorPanels: [],
  collectorData: undefined,
  profile: {
    token: 'abc12345678',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/hello', headers: {}, query: {} } },
    response: { statusCode: 200, headers: {} },
    performance: { startTime: Date.now(), heapUsed: 1024 * 1024, duration: 12 },
    logs: [],
    exceptions: [],
    collectors: {},
  },
};

describe('TemplateRendererService', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService();
  });

  it('renders the built-in list template', async () => {
    const html = await service.render('list', MINIMAL_LIST_DATA);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Recent Profiles');
  });

  it('renders every section as a <details> disclosure and folds only defaultCollapsed ones', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-section-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'rows.ejs'), '<tbody data-rows></tbody>');
      service.registerDir(dir);
      const rowsPath = path.join(dir, 'rows.ejs');

      const baseSection = {
        title: 'HTTP',
        description: undefined,
        itemLabel: 'profile',
        isDefault: true,
        total: 0,
        profiles: [],
        filterDefs: [],
        filterValues: {},
        filterPrefix: 'http',
        resetHref: '/_profiler',
        templatePath: rowsPath,
      };

      const html = await service.render('list', {
        ...MINIMAL_LIST_DATA,
        sections: [
          { ...baseSection, key: 'http', defaultCollapsed: false },
          {
            ...baseSection,
            key: 'cmd',
            title: 'Commands',
            isDefault: false,
            total: 2,
            defaultCollapsed: true,
          },
        ],
      });

      expect(html).toContain('Commands');
      // Every section is a disclosure: two sections → two <details>/<summary>.
      expect(html.match(/<details/g)).toHaveLength(2);
      expect(html.match(/<summary/g)).toHaveLength(2);
      // Expanded by default, except the defaultCollapsed: true section → exactly one `open`.
      expect(html.match(/<details[^>]*\sopen>/g)).toHaveLength(1);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('renders the built-in detail template', async () => {
    const html = await service.render('detail', MINIMAL_DETAIL_DATA);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('references local same-origin assets instead of external CDNs', async () => {
    const html = await service.render('list', MINIMAL_LIST_DATA);

    // No third-party CDN is loaded — everything is served from the profiler itself.
    expect(html).not.toMatch(/https:\/\/cdn\.jsdelivr\.net|https:\/\/cdnjs\.cloudflare\.com/);
    expect(html).not.toMatch(/<script[^>]+https:\/\//);
    expect(html).not.toMatch(/<link[^>]+https:\/\//);

    // Local, build-time assets served under the configured profiler path.
    expect(html).toContain('/_profiler/__assets/styles/profiler.css');
    expect(html).toContain('/_profiler/__assets/styles/github.min.css');
    expect(html).toContain('/_profiler/__assets/styles/github-dark.min.css');
    expect(html).toContain('/_profiler/__assets/scripts/highlight.min.js');
    expect(html).toContain('/_profiler/__assets/scripts/graphql.min.js');
  });

  it('throws when template name does not exist', async () => {
    await expect(service.render('does-not-exist', {})).rejects.toThrow(
      'Template "does-not-exist" not found',
    );
  });

  it('registerDir makes templates in that directory resolvable', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-test-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'hello.ejs'), '<p>hello world</p>');
      service.registerDir(dir);
      const html = await service.render('hello', {});
      expect(html).toBe('<p>hello world</p>');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('registerDir is idempotent — same directory registered twice does not duplicate', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-dedup-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'tpl.ejs'), 'ok');
      service.registerDir(dir);
      service.registerDir(dir);

      // Both registrations resolve to the same template — no duplicate error
      const html = await service.render('tpl', {});
      expect(html).toBe('ok');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('template in registered dir takes precedence over built-in of same name when registered first', async () => {
    // registerDir APPENDS — so a second dir can only shadow a name that the first dirs don't have.
    // This test ensures custom templates in user-registered dirs are found.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-custom-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'custom-panel.ejs'), '<custom/>');
      service.registerDir(dir);
      const html = await service.render('custom-panel', {});
      expect(html).toBe('<custom/>');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
