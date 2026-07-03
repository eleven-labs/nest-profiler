import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { AppModule } from './app.module.js';
import { applyGlobalPrefix } from './config/global-prefix.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');
  const isPinoLoggerEnabled = configService.getOrThrow<boolean>('features.pinoLogger');

  // Wrap the chosen logger so all log calls are captured into the active profile.
  const profilerService = app.get(ProfilerService);
  const baseLogger: LoggerService = isPinoLoggerEnabled
    ? app.get(PinoLogger)
    : new ConsoleLogger('ExampleApi');
  app.useLogger(profilerService.createLogger(baseLogger));

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

  await app.listen(port);
}

void bootstrap();
