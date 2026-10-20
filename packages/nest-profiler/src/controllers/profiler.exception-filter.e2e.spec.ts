import type { Server } from 'node:http';
import { Catch, Controller, Put, UseFilters } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { TracerService } from '../services/tracer.service';
import { ProfilerStorageService } from '../services/profiler-storage.service';
import { createProfilerLogger } from '../services/profiler-logger-adapter';
import type { Profile } from '../interfaces/profile.interface';

/**
 * Exception filters run after the interceptor's `catchError`: they pick the status, write the
 * error body and usually log the failure. The profile used to be closed before them, so it was
 * stored with a guessed 500, no body, and without the line the filter logged.
 */

class ConflictError extends Error {
  override readonly name = 'ConflictError';
}

const logger = createProfilerLogger({ error: jest.fn() }, { attachTraceIdToLogs: false });

@Catch(ConflictError)
class ConflictFilter implements ExceptionFilter {
  catch(exception: ConflictError, host: ArgumentsHost): void {
    logger.error('Conflict caught by the filter', 'ConflictFilter');
    host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>()
      .status(409)
      .json({ errors: exception.message });
  }
}

@Controller()
@UseFilters(ConflictFilter)
class WidgetController {
  @Put('/widgets/1')
  update(): void {
    throw new ConflictError('The widget is locked');
  }
}

describe('a failure answered by an exception filter', () => {
  let app: INestApplication;
  let profile: Profile;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ collectBody: true })],
      controllers: [WidgetController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer() as Server).put('/widgets/1');
    expect(res.status).toBe(409);
    // Persistence is deferred off the response path — drain it before reading the profile.
    await app.get(TracerService).flush();
    const stored = await app
      .get(ProfilerStorageService)
      .findOne(res.headers['x-debug-token'] as string);
    if (!stored) throw new Error('expected a stored profile');
    profile = stored;
  });

  afterAll(async () => await app.close());

  it('records the status the filter answered with', () => {
    expect(profile.response?.statusCode).toBe(409);
  });

  it('records the body the filter wrote', () => {
    expect(profile.response?.body).toEqual({ errors: 'The widget is locked' });
  });

  it('keeps the line the filter logged', () => {
    expect(profile.logs).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'Conflict caught by the filter',
        context: 'ConflictFilter',
      }),
    ]);
  });

  it('records the exception once', () => {
    expect(profile.exceptions).toHaveLength(1);
    expect(profile.exceptions[0]).toMatchObject({
      name: 'ConflictError',
      message: 'The widget is locked',
    });
  });
});
