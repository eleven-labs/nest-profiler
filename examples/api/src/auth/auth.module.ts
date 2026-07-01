import { Module } from '@nestjs/common';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';
import { isProfilerEnabled } from '../config/app.config.js';
import { AuthController } from './http/auth.controller.js';
import { JwtAuthGuard } from './http/jwt-auth.guard.js';
import { TokenService } from './application/token.service.js';

@Module({
  imports: [
    AuthCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      maskUserFields: ['password', 'refreshToken'],
    }),
  ],
  providers: [JwtAuthGuard, TokenService],
  controllers: [AuthController],
})
export class AuthModule {}
