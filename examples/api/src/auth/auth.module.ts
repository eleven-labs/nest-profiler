import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';
import { isProfilerEnabled } from '../config/app.config.js';
import { AuthController } from './http/auth.controller.js';
import { JwtAuthGuard } from './http/jwt-auth.guard.js';
import { TokenService } from './application/token.service.js';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] }),
      isProfilerEnabled,
    ),
  ],
  providers: [JwtAuthGuard, TokenService],
  controllers: [AuthController],
})
export class AuthModule {}
