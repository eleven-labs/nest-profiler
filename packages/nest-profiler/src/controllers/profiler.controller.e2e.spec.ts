import type { Server } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Controller, Get, Header, Injectable } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { ProfilerCollector } from '../collectors/collector.decorator';
import type { IProfilerCollector } from '../collectors/collector.interface';
import type { Profile } from '../interfaces/profile.interface';

// Absolute path to a throwaway sub-panel template, written in beforeAll. The
// grouped collector points at it so the group tab renders end-to-end.
let subPanelTemplate = '';

@Controller()
class DummyController {
  @Get('/hello')
  hello(): { message: string } {
    return { message: 'world' };
  }

  @Get('/page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return '<html><body><h1>hi</h1></body></html>';
  }
}

// A plain (ungrouped) collector — exercises the controller's single-collector
// tab branch (`collectorData = profile.collectors[tab]`).
@Injectable()
@ProfilerCollector({ name: 'custom', label: 'Custom', priority: 60 })
class CustomCollector implements IProfilerCollector {
  readonly name = 'custom';
  collect(): { hits: number } {
    return { hits: 1 };
  }
  getBadgeValue(): string {
    return '1';
  }
}

// A grouped collector — exercises the controller's group-tab branch, which
// assembles `subPanels` data from `profile.collectors`.
@Injectable()
@ProfilerCollector({
  name: 'sql',
  label: 'SQL',
  group: 'database',
  groupLabel: 'Database',
  priority: 70,
})
class SqlCollector implements IProfilerCollector {
  readonly name = 'sql';
  collect(): { query: string }[] {
    return [{ query: 'SELECT 1' }];
  }
  getBadgeValue(): string {
    return '1';
  }
  getTemplatePath(): string {
    return subPanelTemplate;
  }
}

describe('ProfilerController (e2e)', () => {
  let app: INestApplication;

  let templateDir = '';

  beforeAll(async () => {
    templateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiler-e2e-'));
    subPanelTemplate = path.join(templateDir, 'sql-panel.ejs');
    await fs.promises.writeFile(
      subPanelTemplate,
      '<div class="sql-panel"><%= toJson(data) %></div>',
    );

    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ collectBody: true })],
      controllers: [DummyController],
      providers: [CustomCollector, SqlCollector],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await fs.promises.rm(templateDir, { recursive: true, force: true });
  });

  const server = (): Server => app.getHttpServer() as Server;

  /** Issues a profiled request and returns the generated profiler token. */
  async function createProfile(path = '/hello'): Promise<string> {
    const res = await request(server()).get(path);
    const token = res.headers['x-debug-token'];
    expect(token).toBeDefined();
    return token;
  }

  describe('GET /_profiler (list)', () => {
    it('renders the HTML list page', async () => {
      const res = await request(server()).get('/_profiler');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Recent Profiles');
    });

    it('lists a profile after a profiled request', async () => {
      const token = await createProfile('/hello');
      const res = await request(server()).get('/_profiler');
      expect(res.text).toContain(token.slice(0, 8));
    });

    it('accepts filter query parameters', async () => {
      await createProfile('/hello');
      const res = await request(server()).get('/_profiler').query({
        method: 'GET',
        statusCode: '200',
        minDuration: '0',
        maxDuration: '10000',
        url: 'hello',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /_profiler/:token/data', () => {
    it('returns the stored profile as JSON', async () => {
      const token = await createProfile('/hello');
      const res = await request(server()).get(`/_profiler/${token}/data`);
      expect(res.status).toBe(200);
      const body = res.body as Profile;
      expect(body.token).toBe(token);
      expect(body.request.url).toBe('/hello');
    });

    it('returns 404 for an unknown token', async () => {
      const res = await request(server()).get('/_profiler/does-not-exist/data');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /_profiler/:token (detail)', () => {
    it('renders the HTML detail page', async () => {
      const token = await createProfile('/hello');
      const res = await request(server()).get(`/_profiler/${token}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<!DOCTYPE html>');
    });

    it('returns 404 for an unknown token', async () => {
      const res = await request(server()).get('/_profiler/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('renders a single-collector tab', async () => {
      const token = await createProfile('/hello');
      const res = await request(server()).get(`/_profiler/${token}`).query({ tab: 'custom' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
    });

    it('renders a grouped-collector tab (assembling sub-panel data)', async () => {
      const token = await createProfile('/hello');
      const res = await request(server()).get(`/_profiler/${token}`).query({ tab: 'database' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
    });
  });

  describe('toolbar injection', () => {
    it('injects the profiler toolbar into HTML responses', async () => {
      const res = await request(server()).get('/page');
      expect(res.status).toBe(200);
      expect(res.text).toContain('id="profiler-toolbar"');
      expect(res.text.indexOf('id="profiler-toolbar"')).toBeLessThan(res.text.indexOf('</body>'));
    });
  });

  describe('ProfilerGuard (PROFILER_TOKEN set)', () => {
    const SECRET = 's3cret';

    beforeEach(() => {
      process.env['PROFILER_TOKEN'] = SECRET;
    });

    afterEach(() => {
      delete process.env['PROFILER_TOKEN'];
    });

    it('rejects requests without a valid bearer token', async () => {
      const res = await request(server()).get('/_profiler');
      expect(res.status).toBe(401);
    });

    it('allows requests with the correct bearer token', async () => {
      const res = await request(server())
        .get('/_profiler')
        .set('Authorization', `Bearer ${SECRET}`);
      expect(res.status).toBe(200);
    });
  });
});
