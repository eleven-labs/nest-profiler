import { Module } from '@nestjs/common';
import { DiagnosticsController } from './http/diagnostics.controller.js';
import { GreetCommand } from './cli/greet.command.js';

/**
 * Diagnostics surface for the demo. Groups the artificial profiler showcases: the `/slow` and
 * `/error` HTTP endpoints and the `demo:greet` CLI command (which can fail on purpose). No
 * infrastructure — always loaded.
 */
@Module({
  controllers: [DiagnosticsController],
  providers: [GreetCommand],
})
export class DiagnosticsModule {}
