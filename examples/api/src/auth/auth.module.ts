import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';
import { isProfilerEnabled } from '../config/profiler.config.js';
import { AuthController } from './http/auth.controller.js';
import { JwtAuthGuard } from './http/jwt-auth.guard.js';
import { TokenService } from './application/token.service.js';

@Module({
  imports: [
    // Showcases the collectors' `forRootAsync`: the masked user fields are resolved from
    // `ConfigService` (the `profiler` namespace), while gating stays `ConditionalModule`'s job.
    ConditionalModule.registerWhen(
      AuthCollectorModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          maskUserFields: config.get<string[]>('profiler.maskUserFields') ?? [
            'password',
            'refreshToken',
          ],
        }),
      }),
      isProfilerEnabled,
    ),
  ],
  providers: [JwtAuthGuard, TokenService],
  controllers: [AuthController],
})
export class AuthModule {}
