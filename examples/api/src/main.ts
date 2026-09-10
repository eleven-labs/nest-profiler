import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import type { Express } from 'express';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { createProfilerInstrument, createProfilerLogger } from '@eleven-labs/nest-profiler';
import {
  createProfilerValidationPipe,
  createClassValidatorPipe,
} from '@eleven-labs/nest-profiler-validator';
import { AppModule } from './app.module.js';
import { applyGlobalPrefix } from './config/global-prefix.js';

// Vercel imports this file and watches for `listen()` for about a second before giving up; a
// bootstrap this size never makes it in time, so there it exports the request handler instead.
const isServerless = Boolean(process.env['VERCEL']);

async function bootstrap(): Promise<Express | undefined> {
  // On by default *here*, unlike the library: this app exists to show what the profiler can do,
  // and the call tree — who called whom, and what each cost — is invisible without it. Set
  // PROFILER_INSTRUMENT=false to see the trace as an application that has not opted in sees it.
  //
  // It stays opt-in in the library itself: it places a Proxy on every provider, so every property
  // access goes through a trap whether or not the request is profiled. That is a demo's cost to
  // pay, not a production application's.
  const instrumentEnabled = !['0', 'false', 'off', 'no'].includes(
    (process.env.PROFILER_INSTRUMENT ?? '').trim().toLowerCase(),
  );

  // PROFILER_INSTRUMENT_EXCLUDE='ConfigService,*.getRequestId' keeps the named classes and methods
  // off the trace — the noise a real application's call tree is buried under.
  const exclude = (process.env.PROFILER_INSTRUMENT_EXCLUDE ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    ...(instrumentEnabled ? { instrument: createProfilerInstrument({ exclude }) } : {}),
  });

  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');
  const isPinoLoggerEnabled = configService.getOrThrow<boolean>('features.pinoLogger');

  // Wrap the chosen logger so all log calls are captured into the active profile. createProfilerLogger
  // is DI-free (it reads the active profile from CLS), so this needs no TracerService and works
  // whether the profiler is enabled or not.
  const baseLogger: LoggerService = isPinoLoggerEnabled
    ? app.get(PinoLogger)
    : new ConsoleLogger('ExampleApi');
  app.useLogger(createProfilerLogger(baseLogger));

  // App-owned validation pipe: always runs, and feeds the Validator panel when the profiler is on.
  // createClassValidatorPipe (not a bare ValidationPipe) keeps per-property violations in the panel.
  app.useGlobalPipes(
    createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
  );

  applyGlobalPrefix(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('nest-profiler — example API')
    .setDescription(
      'Example NestJS application demonstrating all @eleven-labs/nest-profiler collectors.\n\n' +
        'Open `/_profiler` after any request to inspect the collected profile.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build();

  const SWAGGER_UI_DIST = 'https://unpkg.com/swagger-ui-dist@5.32.6';

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document, {
    customCssUrl: `${SWAGGER_UI_DIST}/swagger-ui.css`,
    customJs: [
      `${SWAGGER_UI_DIST}/swagger-ui-bundle.js`,
      `${SWAGGER_UI_DIST}/swagger-ui-standalone-preset.js`,
    ],
    swaggerOptions: { persistAuthorization: true },
  });

  if (isServerless) {
    await app.init();
    app.flushLogs();
    return app.getHttpAdapter().getInstance();
  }

  await app.listen(port);
  return undefined;
}

// Top-level await: the module stays unresolved until the app is ready, so the handler is
// exported before anything reads it. Locally the app listens and this export is unused.
export default await bootstrap();
