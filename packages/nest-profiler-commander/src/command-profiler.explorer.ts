import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { CommandRunner } from 'nest-commander';
import { CommandProfiler } from './command-profiler.service';
import type { CommandProfileMeta } from './command-profiler.service';

/** Minimal shape of a commander `Option` whose value parser we wrap. */
interface CommandOptionLike {
  flags?: string;
  attributeName?: () => string;
  parseArg?: (value: string, previous: unknown) => unknown;
}

/** Minimal shape of the commander `Command` nest-commander attaches to a runner. */
interface CommanderCommandLike {
  name?: () => string;
  opts?: () => Record<string, unknown>;
  options?: CommandOptionLike[];
}

/** Minimal shape of a nest-commander `CommandRunner` instance we interact with. */
interface CommandRunnerLike {
  run(passedParams: string[], options?: Record<string, unknown>): Promise<void>;
  command?: CommanderCommandLike;
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
      this.wrapOptionParsers(instance);
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
    const commandName = (): string => this.commandName(instance);

    instance.run = function wrappedRun(
      passedParams: string[],
      options: Record<string, unknown> = {},
    ): Promise<void> {
      return profiler.profile({ name: commandName(), arguments: passedParams ?? [], options }, () =>
        original(passedParams, options),
      );
    };
  }

  /**
   * Wraps the value parser of every `@Option()` of a command so a parser that rejects its input
   * is still profiled. Commander evaluates these parsers while it parses the argv, i.e. **before**
   * the action handler — so a throwing parser aborts the invocation without ever entering the
   * `run()` wrapper installed above, and the failed command would otherwise leave no trace at all.
   */
  private wrapOptionParsers(instance: CommandRunnerLike): void {
    for (const option of instance.command?.options ?? []) {
      const parseArg = option.parseArg;
      if (typeof parseArg !== 'function') continue;

      option.parseArg = (value: string, previous: unknown): unknown => {
        try {
          return parseArg(value, previous);
        } catch (error) {
          // The error is rethrown untouched: the CLI must fail exactly as it did before.
          this.profiler.profileParseFailure(this.parseFailureMeta(instance, option, value), error);
          throw error;
        }
      };
    }
  }

  /**
   * Describes the invocation as far as commander got before the parser threw: the options it had
   * already resolved (declared defaults included), plus the **raw** value the rejected flag was
   * given — no parsed value exists for it. Positional operands are assigned only once every
   * option has parsed, so none are known yet.
   */
  private parseFailureMeta(
    instance: CommandRunnerLike,
    option: CommandOptionLike,
    value: string,
  ): CommandProfileMeta {
    const command = instance.command;
    const name = option.attributeName?.() ?? option.flags ?? 'unknown';
    return {
      name: this.commandName(instance),
      arguments: [],
      options: { ...command?.opts?.(), [name]: value },
    };
  }

  /** The command's declared name (`@Command({ name })`), falling back to its class name. */
  private commandName(instance: CommandRunnerLike): string {
    return instance.command?.name?.() ?? instance.constructor.name;
  }
}
