import type { Server } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Post,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { ProfilerService } from '../services/nest-profiler.service';
import { ProfilerStorageService } from '../services/profiler-storage.service';
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

  @Post('/widgets')
  @HttpCode(201)
  createWidget(): { created: boolean } {
    return { created: true };
  }

  @Get('/boom')
  boom(): never {
    throw new BadRequestException('kaboom');
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
  async function createProfile(path = '/hello', method: 'get' | 'post' = 'get'): Promise<string> {
    const res = await request(server())[method](path);
    const token = res.headers['x-debug-token'];
    if (typeof token !== 'string') {
      throw new Error('expected the x-debug-token header to be set');
    }
    // Persistence is deferred off the response path — drain it before asserting.
    await app.get(ProfilerService).flush();
    return token;
  }

  /** Short token form as rendered in the list, useful for present/absent assertions. */
  const short = (token: string): string => token.slice(0, 8);

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

    it('narrows the list by HTTP method', async () => {
      const getToken = await createProfile('/hello', 'get');
      const postToken = await createProfile('/widgets', 'post');

      const res = await request(server()).get('/_profiler').query({ method: 'POST' });
      expect(res.text).toContain(short(postToken));
      expect(res.text).not.toContain(short(getToken));
    });

    it('narrows the list by exact status and by status class', async () => {
      const okToken = await createProfile('/hello', 'get'); // 200
      const errToken = await createProfile('/boom', 'get'); // 400

      const byExact = await request(server()).get('/_profiler').query({ status: '400' });
      expect(byExact.text).toContain(short(errToken));
      expect(byExact.text).not.toContain(short(okToken));

      const byClass = await request(server()).get('/_profiler').query({ statusClass: '4' });
      expect(byClass.text).toContain(short(errToken));
      expect(byClass.text).not.toContain(short(okToken));
    });

    it('narrows the list by global search and by exceptions', async () => {
      const helloToken = await createProfile('/hello', 'get');
      const errToken = await createProfile('/boom', 'get');

      const bySearch = await request(server()).get('/_profiler').query({ q: 'hello' });
      expect(bySearch.text).toContain(short(helloToken));
      expect(bySearch.text).not.toContain(short(errToken));

      const byException = await request(server()).get('/_profiler').query({ hasExceptions: '1' });
      expect(byException.text).toContain(short(errToken));
      expect(byException.text).not.toContain(short(helloToken));
    });

    it('ignores non-numeric filter values instead of hiding all profiles', async () => {
      const token = await createProfile('/hello');
      const res = await request(server())
        .get('/_profiler')
        .query({ status: 'not-a-number', minDuration: 'abc' });
      expect(res.status).toBe(200);
      // Invalid numeric filters are dropped, so the profile is still listed.
      expect(res.text).toContain(token.slice(0, 8));
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

  describe('command profiles', () => {
    const cmdToken = 'cmd-e2e-token-12345678';

    /** Persists a synthetic CLI command profile (as the commander collector would). */
    async function saveCommandProfile(success = true): Promise<void> {
      const storage = app.get(ProfilerStorageService);
      await storage.save({
        token: cmdToken,
        createdAt: Date.now(),
        request: {
          method: 'CLI',
          url: 'demo:greet world',
          headers: {},
          query: {},
          command: {
            name: 'demo:greet',
            arguments: ['world'],
            options: {},
            exitCode: success ? 0 : 1,
            success,
          },
        },
        response: { statusCode: success ? 200 : 500, headers: {} },
        performance: { startTime: Date.now(), heapUsed: 1024, duration: 5 },
        logs: [],
        exceptions: [],
        collectors: {},
      });
    }

    it('lists commands in a dedicated table on the list page', async () => {
      await saveCommandProfile();
      const res = await request(server()).get('/_profiler');
      expect(res.status).toBe(200);
      expect(res.text).toContain('>Commands<');
      expect(res.text).toContain('demo:greet');
    });

    it('renders the command detail without request/response tabs (defaults to the command panel)', async () => {
      await saveCommandProfile();
      const res = await request(server()).get(`/_profiler/${cmdToken}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('demo:greet');
      // HTTP-only tabs are dropped for commands.
      expect(res.text).not.toContain('tab=request');
      expect(res.text).not.toContain('tab=response');
    });

    it('honours an explicit builtin tab on a command profile', async () => {
      await saveCommandProfile(false);
      const res = await request(server())
        .get(`/_profiler/${cmdToken}`)
        .query({ tab: 'performance' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('FAILED');
    });
  });

  describe('logs tab', () => {
    const logToken = 'log-e2e-token-123456789';

    it('renders the message before the context and the data payload as JSON', async () => {
      const storage = app.get(ProfilerStorageService);
      await storage.save({
        token: logToken,
        createdAt: Date.now(),
        request: { method: 'GET', url: '/hello', headers: {}, query: {} },
        response: { statusCode: 200, headers: {} },
        performance: { startTime: Date.now(), heapUsed: 1024, duration: 5 },
        logs: [
          {
            level: 'log',
            message: 'User logged in',
            context: 'AuthService',
            data: { userId: 42 },
            timestamp: Date.now(),
          },
        ],
        exceptions: [],
        collectors: {},
      });

      const res = await request(server()).get(`/_profiler/${logToken}`).query({ tab: 'logs' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('User logged in');
      expect(res.text).toContain('AuthService');
      // The data payload is rendered as escaped, pretty-printed JSON.
      expect(res.text).toContain('&#34;userId&#34;: 42');
      // Column order: Message comes before Context.
      expect(res.text.indexOf('>Message<')).toBeGreaterThan(-1);
      expect(res.text.indexOf('>Message<')).toBeLessThan(res.text.indexOf('>Context<'));
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
