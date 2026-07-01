import { Module } from '@nestjs/common';
import { HealthController } from './http/health.controller.js';

/** Liveness endpoint (`GET /health`). No infrastructure — always loaded. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
