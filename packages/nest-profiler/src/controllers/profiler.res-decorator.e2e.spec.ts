import type { Server } from 'node:http';
import { Controller, Get, Post, Res } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { TracerService } from '../services/tracer.service';
import { ProfilerStorageService } from '../services/profiler-storage.service';
import type { PlatformResponse } from '../types/http';

/**
 * A controller taking over the response with `@Res()` returns the transport object, because
 * `res.json()` / `res.send()` / `res.status()` all evaluate to the response itself. The profiler
 * used to store that object as the response body, so the Response tab showed the serialized
 * `ServerResponse` — its `req`, sockets and raw headers — instead of the payload.
 *
 * These tests pin the payload from the outside, for both write methods and for a body sent after
 * the handler returned.
 *
 * Regression coverage for #285.
 */

@Controller()
class ResController {
  @Get('/quota')
  quota(@Res() response: PlatformResponse): unknown {
    return (response as unknown as { json(body: unknown): unknown }).json({
      data: { quota: 3 },
    });
  }

  @Post('/share')
  share(@Res() response: PlatformResponse): unknown {
    const res = response as unknown as {
      status(code: number): { send(body: unknown): unknown };
    };
    return res.status(201).send({ data: { url: 'https://example.test/a' } });
  }

  @Get('/deferred')
  deferred(@Res() response: PlatformResponse): void {
    // Written after the handler returned — the interceptor has already finalized by then.
    setTimeout(() => {
      (response as unknown as { json(body: unknown): unknown }).json({ data: { late: true } });
    }, 5);
  }
}

describe('response body capture with @Res()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ collectBody: true })],
      controllers: [ResController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => await app.close());

  /** Issues a profiled request and returns the profile the profiler stored for it. */
  async function profileOf(
    call: (server: Server) => request.Test,
  ): Promise<{ statusCode?: number; body?: unknown }> {
    const server = app.getHttpServer() as Server;
    const res = await call(server);
    const token = res.headers['x-debug-token'] as string;
    // Persistence is deferred off the response path — drain it before reading the profile.
    await app.get(TracerService).flush();
    const profile = await app.get(ProfilerStorageService).findOne(token);
    if (!profile) throw new Error(`expected a stored profile for token ${token}`);
    return { statusCode: profile.response?.statusCode, body: profile.response?.body };
  }

  it('records the payload passed to res.json(), not the response object', async () => {
    const { statusCode, body } = await profileOf((server) => request(server).get('/quota'));

    expect(statusCode).toBe(200);
    expect(body).toEqual({ data: { quota: 3 } });
  });

  it('records the payload passed to res.status().send()', async () => {
    const { statusCode, body } = await profileOf((server) => request(server).post('/share'));

    expect(statusCode).toBe(201);
    expect(body).toEqual({ data: { url: 'https://example.test/a' } });
  });

  it('backfills a body written after the handler returned', async () => {
    const { body } = await profileOf((server) => request(server).get('/deferred'));

    expect(body).toEqual({ data: { late: true } });
  });
});
