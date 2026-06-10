import type { INestApplication } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { AppModule } from '../../src/app.module.js';
import { isPinoLoggerEnabled } from '../../src/config/features.config.js';

export type SqlOrm = 'typeorm' | 'mikro-orm';

/** The ORM selected for this run — the CI matrix sets SQL_ORM; local default is typeorm. */
export const activeSqlOrm = (): SqlOrm =>
  process.env['SQL_ORM'] === 'mikro-orm' ? 'mikro-orm' : 'typeorm';

export const inactiveSqlOrm = (): SqlOrm =>
  activeSqlOrm() === 'mikro-orm' ? 'typeorm' : 'mikro-orm';

/** Boots the real AppModule and mirrors the logger wiring from `src/main.ts`. */
export async function createE2EApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });

  const profilerService = app.get(ProfilerService);
  const baseLogger = isPinoLoggerEnabled(process.env)
    ? app.get(PinoLogger)
    : new ConsoleLogger('e2e');
  app.useLogger(profilerService.createLogger(baseLogger));

  await app.init();
  return app;
}

export const server = (app: INestApplication): Server => app.getHttpServer() as Server;

/** Extracts the profiler token issued for a profiled response. */
export function tokenOf(res: Response): string {
  const token = res.headers['x-debug-token'];
  if (typeof token !== 'string') {
    throw new Error(`missing x-debug-token header on ${res.request.method} ${res.request.url}`);
  }
  return token;
}

/**
 * Fetches the raw profile recorded for `token` via the profiler's JSON endpoint.
 * Profiles are collected and saved after the response is sent, so this polls
 * briefly — like a client following X-Debug-Token-Link — until the profile lands.
 */
export async function getProfile(app: INestApplication, token: string): Promise<Profile> {
  for (let attempt = 0; ; attempt++) {
    const res = await request(server(app)).get(`/_profiler/${token}/data`);
    if (res.status === 200) return res.body as Profile;
    if (attempt >= 20) {
      throw new Error(`expected profile ${token} to exist, got HTTP ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Performs a request and returns the profile it produced. */
export async function profileOf(
  app: INestApplication,
  method: 'get' | 'post' | 'delete',
  path: string,
  body?: string | object,
): Promise<{ res: Response; profile: Profile }> {
  let req = request(server(app))[method](path);
  if (body !== undefined) req = req.send(body);
  const res = await req;
  const profile = await getProfile(app, tokenOf(res));
  return { res, profile };
}
