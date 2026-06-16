import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { RabbitMqCollectorModule } from '@eleven-labs/nest-profiler-rabbitmq';
import { isProfilerEnabled } from '../config/app.config.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [
    ConfigModule.forFeature(rabbitmqConfig),
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('rabbitmq.uri')!,
        exchanges: [{ name: config.get<string>('rabbitmq.exchange')!, type: 'topic' }],
        // Don't block bootstrap when the broker is unreachable — the demo app
        // still starts and the consumer connects once RabbitMQ is up.
        connectionInitOptions: { wait: false },
      }),
    }),
    // Profiles each consumed message as a `rabbitmq` entrypoint.
    RabbitMqCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class AppRabbitMqModule {}
