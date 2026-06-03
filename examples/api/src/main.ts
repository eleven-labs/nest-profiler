import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const profilerService = app.get(ProfilerService);
  app.useLogger(profilerService.createLogger(new ConsoleLogger('ExampleApi')));

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

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

void bootstrap();
