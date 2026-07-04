import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { CommandRunner } from 'nest-commander';
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
 * `nest-commander` is a **required** peer of this package (you only use the commander collector
 * when you build a nest-commander CLI), so its `CommandRunner` class is imported statically and
 * used directly as the `instanceof` discriminant — no lazy/optional loading.
 */
@Injectable()
export class CommandProfilerExplorer implements OnApplicationBootstrap {
  private readonly wrapped = new WeakSet<object>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly profiler: CommandProfiler,
  ) {}

  onApplicationBootstrap(): void {
    const RunnerClass = this.getCommandRunnerClass();

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as unknown;
      if (!this.isCommand(instance, RunnerClass)) continue;
      if (this.wrapped.has(instance)) continue;
      this.wrapCommand(instance);
      this.wrapped.add(instance);
    }
  }

  /**
   * nest-commander's `CommandRunner` abstract class (the `instanceof` discriminant). Exposed as
   * a protected seam so tests can substitute a stand-in without instantiating the real class.
   */
  protected getCommandRunnerClass(): CommandRunnerClass {
    return CommandRunner as unknown as CommandRunnerClass;
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
