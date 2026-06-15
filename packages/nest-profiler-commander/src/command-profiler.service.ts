import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { COMMAND_ENTRYPOINT_TYPE } from './commander-collector.interface';
import type { CommandInfo } from './commander-collector.interface';
import { COMMAND_ENTRYPOINT_TYPE_DEF } from './commander-entrypoint';

/** Identifies the command being profiled. */
export interface CommandProfileMeta {
  name: string;
  arguments: string[];
  options: Record<string, unknown>;
}

/**
 * Replicates the HTTP profiling flow (`ProfilerMiddleware` + `ProfilerInterceptor`) for
 * CLI commands, which never traverse the HTTP middleware/interceptor pipeline.
 *
 * It synthesises a `Profile` with a `command` entrypoint, runs the command body inside a
 * CLS context so nested profile-scoped collectors (axios, cache, DB, …) keep capturing
 * data, then runs every collector and persists the profile via the shared storage. With
 * file storage the resulting profile shows up in the web profiler at `/_profiler`.
 */
@Injectable()
export class CommandProfiler implements OnModuleInit {
  private readonly logger = new Logger(CommandProfiler.name);
  private warnedProcessLocalStorage = false;

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
  ) {}

  /**
   * Registers the `command` entrypoint type so the profiler renders command
   * profiles in their own list table and Command detail tab. Runs only when the
   * collector is enabled (this provider exists only then).
   */
  onModuleInit(): void {
    this.core.registerEntrypointType(COMMAND_ENTRYPOINT_TYPE_DEF);
  }

  async profile(meta: CommandProfileMeta, exec: () => Promise<void>): Promise<void> {
    this.warnIfProcessLocalStorage();

    const profile = this.buildProfile(meta);
    let error: Error | undefined;

    await this.cls.run(async () => {
      this.cls.set('profiler.token', profile.token);
      this.cls.set('profiler.profile', profile);

      try {
        await exec();
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      }

      this.finalize(profile, meta, error);
      await this.core.collectorRegistry.collectAll(profile);
      await this.core.storage.save(profile);
    });

    if (error) throw error;
  }

  /**
   * Commands typically run in a separate process from the web profiler. With a process-local
   * store (in-memory) the profile would be saved to this process's heap and never seen by the
   * server — warn once so the cause is obvious.
   */
  private warnIfProcessLocalStorage(): void {
    if (this.warnedProcessLocalStorage || this.core.storage.crossProcess) return;
    this.warnedProcessLocalStorage = true;
    this.logger.warn(
      'Command profiles are being saved to an in-memory store, which is local to this ' +
        'process. They will not appear in the web profiler running in another process. ' +
        "Use a cross-process storage adapter (e.g. storageType: 'file') to view command profiles.",
    );
  }

  private buildProfile(meta: CommandProfileMeta): Profile<CommandInfo> {
    const startTime = Date.now();
    const data: CommandInfo = {
      name: meta.name,
      arguments: meta.arguments,
      options: meta.options,
      exitCode: 0,
      success: true,
    };
    return {
      token: randomUUID(),
      createdAt: startTime,
      // The `command` entrypoint type (registered by CommanderCollectorModule)
      // gives this profile its dedicated list table and Command detail tab.
      entrypoint: { type: COMMAND_ENTRYPOINT_TYPE, data },
      performance: {
        startTime,
        heapUsed: process.memoryUsage().heapUsed,
      },
      logs: [],
      exceptions: [],
      collectors: {},
    };
  }

  private finalize(
    profile: Profile<CommandInfo>,
    _meta: CommandProfileMeta,
    error: Error | undefined,
  ): void {
    profile.performance.duration = Date.now() - profile.performance.startTime;
    profile.response = {
      statusCode: error ? 500 : 200,
      headers: {},
      body: undefined,
    };

    if (error) {
      profile.exceptions.push({
        name: error.name,
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      });
    }

    const data = profile.entrypoint.data;
    data.exitCode = error ? 1 : 0;
    data.success = !error;
  }
}
