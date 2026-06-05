import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { CommandProfiler } from './command-profiler.service';

/** Minimal shape of a nest-commander `CommandRunner` instance we interact with. */
interface CommandRunnerLike {
  run(passedParams: string[], options?: Record<string, unknown>): Promise<void>;
  command?: { name?: () => string };
}

type CommandRunnerClass = abstract new (...args: never[]) => CommandRunnerLike;

/**
 * Discovers every nest-commander command at bootstrap and wraps its `run()` method so the
 * execution is profiled — the CLI equivalent of installing a global interceptor. No user
 * code change is required (Symfony-style automatic command profiling).
 *
 * nest-commander is an optional peer dependency: when it is not installed the explorer is a
 * no-op. Detection is `instanceof CommandRunner` (the publicly exported abstract class).
 */
@Injectable()
export class CommandProfilerExplorer implements OnApplicationBootstrap {
  private readonly wrapped = new WeakSet<object>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly profiler: CommandProfiler,
  ) {}

  onApplicationBootstrap(): void {
    const CommandRunner = this.getCommandRunnerClass();
    if (!CommandRunner) return;

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as unknown;
      if (!this.isCommand(instance, CommandRunner)) continue;
      if (this.wrapped.has(instance)) continue;
      this.wrapCommand(instance);
      this.wrapped.add(instance);
    }
  }

  /** Resolves nest-commander's `CommandRunner`; returns `undefined` when not installed. */
  protected getCommandRunnerClass(): CommandRunnerClass | undefined {
    try {
      return this.loadNestCommander().CommandRunner;
    } catch {
      return undefined;
    }
  }

  /** Loads the optional `nest-commander` peer. Isolated as a seam so tests can simulate its absence. */
  protected loadNestCommander(): { CommandRunner: CommandRunnerClass } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('nest-commander') as { CommandRunner: CommandRunnerClass };
  }

  private isCommand(
    instance: unknown,
    CommandRunner: CommandRunnerClass,
  ): instance is CommandRunnerLike {
    return (
      instance instanceof (CommandRunner as unknown as abstract new () => object) &&
      typeof (instance as CommandRunnerLike).run === 'function'
    );
  }

  private wrapCommand(instance: CommandRunnerLike): void {
    const original = instance.run.bind(instance);
    const profiler = this.profiler;

    instance.run = function wrappedRun(
      passedParams: string[],
      options: Record<string, unknown> = {},
    ): Promise<void> {
      const name = instance.command?.name?.() ?? instance.constructor.name;
      return profiler.profile({ name, arguments: passedParams ?? [], options }, () =>
        original(passedParams, options),
      );
    };
  }
}
