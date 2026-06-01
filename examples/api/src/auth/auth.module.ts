import { Module } from '@nestjs/common';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';
import { profilerEnabled } from '../config/profiler-enabled';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    AuthCollectorModule.forRoot({
      enabled: profilerEnabled,
      maskUserFields: ['password', 'refreshToken'],
    }),
  ],
  providers: [JwtAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
