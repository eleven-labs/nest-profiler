import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import {
  nowMs,
  ProfilerCoreService,
  redact,
  sinceMs,
  tryResolve,
} from '@eleven-labs/nest-profiler';
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

  /** Resolved lazily via ModuleRef (traverses to the core's global providers, or `undefined`
   *  when the core is disabled — in which case `profile()` just runs the command). */
  private cls: ClsService | undefined;
  private core: ProfilerCoreService | undefined;

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Registers the `command` entrypoint type so the profiler renders command
   * profiles in their own list table and Command detail tab. Runs only when the
   * collector is enabled (this provider exists only then).
   */
  onModuleInit(): void {
    this.resolveCore();
    this.core?.registerEntrypointType(COMMAND_ENTRYPOINT_TYPE_DEF);
  }

  /** Lazily resolves the core's global providers via ModuleRef (undefined when core disabled). */
  private resolveCore(): void {
    this.cls ??= tryResolve<ClsService>(this.moduleRef, ClsService);
    this.core ??= tryResolve<ProfilerCoreService>(this.moduleRef, ProfilerCoreService);
  }

  async profile(meta: CommandProfileMeta, exec: () => Promise<void>): Promise<void> {
    this.resolveCore();
    // Profiler core disabled → run the command with no profiling rather than crashing.
    if (!this.cls || !this.core) {
      await exec();
      return;
    }
    const cls = this.cls;
    const core = this.core;

    this.warnIfProcessLocalStorage();

    const profile = this.buildProfile(meta);
    let error: Error | undefined;

    await cls.run(async () => {
      cls.set('profiler.token', profile.token);
      cls.set('profiler.profile', profile);

      try {
        await exec();
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      }

      this.finalize(profile, meta, error);

      // Persistence must never fail the command or, worse, replace the command's own error:
      // swallow + log storage/collect failures so `if (error) throw error` below always wins.
      try {
        await core.collectorRegistry.collectAll(profile);
        // Run the same analysis + trace/lifecycle assembly as the HTTP path so commands get
        // performance tags and a Timeline waterfall (the entrypoint root plus any DB/HTTP spans).
        core.finalizeProfile(profile);
        await core.storage.save(profile);
      } catch (persistErr) {
        const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
        this.logger.warn(`Failed to persist command profile: ${message}`);
      }
    });

    if (error) throw error;
  }

  /**
   * Commands typically run in a separate process from the web profiler. With a process-local
   * store (in-memory) the profile would be saved to this process's heap and never seen by the
   * server — warn once so the cause is obvious.
   */
  private warnIfProcessLocalStorage(): void {
    if (this.warnedProcessLocalStorage || !this.core || this.core.storage.crossProcess) return;
    this.warnedProcessLocalStorage = true;
    this.logger.warn(
      'Command profiles are being saved to an in-memory store, which is local to this ' +
        'process. They will not appear in the web profiler running in another process. ' +
        "Use a cross-process storage adapter (e.g. storageType: 'file') to view command profiles.",
    );
  }

  private buildProfile(meta: CommandProfileMeta): Profile<CommandInfo> {
    const startTime = nowMs();
    const data: CommandInfo = {
      name: meta.name,
      // CLI args/options routinely carry secrets (`--password=…`, `--token=…`); redact them.
      arguments: redact(meta.arguments),
      options: redact(meta.options),
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
    profile.performance.duration = sinceMs(profile.performance.startTime);
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
