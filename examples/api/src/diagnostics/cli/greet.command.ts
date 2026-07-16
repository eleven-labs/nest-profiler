import { ConsoleLogger } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { createProfilerLogger } from '@eleven-labs/nest-profiler';

interface GreetOptions {
  name?: string;
  fail?: boolean;
}

/** A minimal command — also demonstrates how a failing command is profiled (use `--fail`). */
@Command({ name: 'demo:greet', description: 'Print a greeting' })
export class GreetCommand extends CommandRunner {
  // Wrap a console logger so log lines are captured into the active profile — no ProfilerService
  // injection needed, so the command resolves cleanly whether the profiler is on or off.
  private readonly logger: LoggerService = createProfilerLogger(
    new ConsoleLogger(GreetCommand.name),
  );

  async run(passedParams: string[], options?: GreetOptions): Promise<void> {
    if (options?.fail) {
      throw new Error('Greeting failed on purpose — see the Exceptions tab in /_profiler');
    }
    const name = options?.name ?? passedParams[0] ?? 'world';
    this.logger.log(`Hello, ${name}!`);
    await Promise.resolve();
  }

  @Option({ flags: '-n, --name <name>', description: 'Name to greet (default: world)' })
  parseName(value: string): string {
    return value;
  }

  @Option({ flags: '--fail', description: 'Make the command throw, to demo a failed profile' })
  parseFail(): boolean {
    return true;
  }
}
