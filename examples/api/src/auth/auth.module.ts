import { Module } from '@nestjs/common';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';
import { isProfilerEnabled } from '../config/app.config.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    AuthCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      maskUserFields: ['password', 'refreshToken'],
    }),
  ],
  providers: [JwtAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
