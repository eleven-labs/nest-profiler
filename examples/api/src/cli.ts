import 'reflect-metadata';

import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module.js';

async function bootstrap(): Promise<void> {
  // CommandFactory builds the Nest app, runs the matched command, and exits.
  await CommandFactory.run(CliModule, { logger: ['error', 'warn'] });
}

void bootstrap();
