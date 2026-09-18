import type { AddressInfo, Server } from 'node:net';
import * as http from 'node:http';
import { Controller, Get, Res, Sse } from '@nestjs/common';
import type { INestApplication, MessageEvent } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Observable, interval, map, take } from 'rxjs';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { TracerService } from '../services/tracer.service';
import { ProfilerStorageService } from '../services/profiler-storage.service';
import type { Profile } from '../interfaces/profile.interface';
import type { PlatformResponse } from '../types/http';

/**
 * A streamed response — Server-Sent Events, an LLM token stream, NDJSON — breaks the assumption
 * every other figure on a profile rests on: that the response is over when the route handler
 * returns. It is not. The handler returns in microseconds and the transport keeps writing for
 * seconds, so the profiler used to file a five-second SSE endpoint as a sub-millisecond request,
 * record one event as the whole response body, and — because NestJS flattens an `@Sse()`
 * handler's Observable straight into the interceptor chain — finalize, run every collector and
 * write to storage **once per event**.
 *
 * These tests pin the behaviour from the outside: the duration covers the stream, the delivery is
 * described rather than guessed at, work done *during* the stream still reaches the panels, and
 * none of it costs the application a single line of its own code.
 */

const EVENT_COUNT = 3;
const EVENT_INTERVAL_MS = 25;

@Controller()
class StreamingController {
  constructor(private readonly tracer: TracerService) {}

  @Sse('/events')
  events(): Observable<MessageEvent> {
    return interval(EVENT_INTERVAL_MS).pipe(
      take(EVENT_COUNT),
      map((n) => {
        // Recorded *after* the handler returned: it only reaches the trace if collection waits
        // for the end of the stream.
        this.tracer.span('event', () => n);
        return { data: { n } } satisfies MessageEvent;
      }),
    );
  }

  /** Raw chunked writing — what an AI SDK `pipeTextStreamToResponse(res)` does. */
  @Get('/tokens')
  tokens(@Res() response: PlatformResponse): void {
    const res = response as unknown as {
      writeHead(code: number, headers: Record<string, string>): void;
      write(chunk: string): boolean;
      end(): void;
    };
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    let sent = 0;
    const timer = setInterval(() => {
      res.write(`token-${sent}\n`);
      if ((sent += 1) === EVENT_COUNT) {
        clearInterval(timer);
        res.end();
      }
    }, EVENT_INTERVAL_MS);
  }

  /**
   * The shape a real AI chat endpoint takes: the handler owns the response, and starts writing
   * only once the model answers — after it has returned.
   */
  @Get('/deferred-stream')
  deferredStream(@Res() response: PlatformResponse): void {
    const res = response as unknown as {
      writeHead(code: number, headers: Record<string, string>): void;
      write(chunk: string): boolean;
      end(): void;
    };
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      let sent = 0;
      const timer = setInterval(() => {
        this.tracer.span('late-chunk', () => sent);
        res.write(`late-${sent}\n`);
        if ((sent += 1) === EVENT_COUNT) {
          clearInterval(timer);
          res.end();
        }
      }, EVENT_INTERVAL_MS);
    }, EVENT_INTERVAL_MS);
  }

  @Get('/plain')
  plain(): { ok: boolean } {
    return { ok: true };
  }
}

describe('streamed responses', () => {
  let app: INestApplication;
  let saves: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ collectBody: true })],
      controllers: [StreamingController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    saves = 0;
    const storage = app.get(ProfilerStorageService);
    const save = storage.save.bind(storage);
    jest.spyOn(storage, 'save').mockImplementation(async (profile) => {
      saves += 1;
      return save(profile);
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => await app.close());

  /** Issues a request and returns the profile the profiler stored for it. */
  async function profileOf(call: (server: Server) => request.Test): Promise<Profile> {
    const res = await call(app.getHttpServer() as Server);
    return readProfile(res.headers['x-debug-token'] as string);
  }

  async function readProfile(token: string): Promise<Profile> {
    // Persistence is deferred off the response path — drain it before reading the profile.
    await app.get(TracerService).flush();
    const profile = await app.get(ProfilerStorageService).findOne(token);
    if (!profile) throw new Error(`expected a stored profile for token ${token}`);
    return profile;
  }

  describe('@Sse()', () => {
    it('measures the whole stream rather than the time it took to open it', async () => {
      const profile = await profileOf((server) => request(server).get('/events'));

      // Three events, 25ms apart: anything close to zero means the profile closed on the first one.
      expect(profile.performance.duration).toBeGreaterThanOrEqual(
        EVENT_INTERVAL_MS * EVENT_COUNT * 0.8,
      );
    });

    it('describes the delivery: chunks, bytes, time to first chunk', async () => {
      const profile = await profileOf((server) => request(server).get('/events'));
      const stream = profile.response?.stream;

      expect(stream).toBeDefined();
      expect(stream?.chunks).toBeGreaterThanOrEqual(EVENT_COUNT);
      expect(stream?.bytes).toBeGreaterThan(0);
      expect(stream?.aborted).toBe(false);
      expect(stream?.contentType).toContain('text/event-stream');
      // The caller waits for the first event, not for the whole stream.
      expect(stream?.timeToFirstChunk).toBeLessThan(profile.performance.duration ?? 0);
    });

    it('stores the profile once, not once per event', async () => {
      await profileOf((server) => request(server).get('/events'));

      expect(saves).toBe(1);
    });

    it('keeps what the stream recorded after the handler returned', async () => {
      const profile = await profileOf((server) => request(server).get('/events'));

      expect(profile.trace?.filter((span) => span.label === 'event')).toHaveLength(EVENT_COUNT);
    });

    it('does not record an individual event as the response body', async () => {
      const profile = await profileOf((server) => request(server).get('/events'));

      expect(profile.response?.body).toBeUndefined();
    });
  });

  describe('raw chunked writing', () => {
    it('is reported as a stream', async () => {
      const profile = await profileOf((server) => request(server).get('/tokens'));
      const stream = profile.response?.stream;

      expect(stream?.chunks).toBe(EVENT_COUNT);
      expect(stream?.aborted).toBe(false);
      expect(profile.performance.duration).toBeGreaterThanOrEqual(
        EVENT_INTERVAL_MS * EVENT_COUNT * 0.8,
      );
    });
  });

  describe('a handler that owns the response and writes later', () => {
    it('is measured over the whole stream', async () => {
      const profile = await profileOf((server) => request(server).get('/deferred-stream'));

      expect(profile.response?.stream?.chunks).toBe(EVENT_COUNT);
      expect(profile.performance.duration).toBeGreaterThanOrEqual(
        EVENT_INTERVAL_MS * EVENT_COUNT * 0.8,
      );
    });

    it('keeps what it recorded while writing', async () => {
      const profile = await profileOf((server) => request(server).get('/deferred-stream'));

      expect(profile.trace?.filter((span) => span.label === 'late-chunk')).toHaveLength(
        EVENT_COUNT,
      );
    });
  });

  it('leaves an ordinary one-shot response alone', async () => {
    const profile = await profileOf((server) => request(server).get('/plain'));

    expect(profile.response?.stream).toBeUndefined();
    expect(profile.response?.body).toEqual({ ok: true });
  });

  it('still saves a stream the client walked away from, flagged as aborted', async () => {
    const server = app.getHttpServer() as Server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const token = await new Promise<string>((resolve, reject) => {
      const req = http.get({ port, path: '/events' }, (res) => {
        const debugToken = res.headers['x-debug-token'] as string;
        // Hang up in the middle of the stream.
        res.once('data', () => {
          req.destroy();
          resolve(debugToken);
        });
      });
      req.once('error', () => undefined);
      setTimeout(() => reject(new Error('no response')), 5000).unref();
    });

    // The abort reaches the server asynchronously; give the close listener a turn.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const profile = await readProfile(token);

    expect(profile.response?.stream?.aborted).toBe(true);
  });
});
