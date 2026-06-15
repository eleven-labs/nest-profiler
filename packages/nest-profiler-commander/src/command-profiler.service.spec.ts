import { Logger } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import type { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { CommandProfiler } from './command-profiler.service';
import { COMMAND_ENTRYPOINT_TYPE_DEF } from './commander-entrypoint';
import { COMMAND_ENTRYPOINT_TYPE } from './commander-collector.interface';
import type { CommandInfo } from './commander-collector.interface';

function createCls(): { cls: ClsService; set: jest.Mock } {
  const store = new Map<string, unknown>();
  const set = jest.fn((key: string, value: unknown) => store.set(key, value));
  const cls = {
    run: (cb: () => unknown): unknown => cb(),
    set,
    get: (key: string): unknown => store.get(key),
  } as unknown as ClsService;
  return { cls, set };
}

function createCore(crossProcess = true): {
  core: ProfilerCoreService;
  save: jest.Mock;
  collectAll: jest.Mock;
  registerEntrypointType: jest.Mock;
  saved: () => Profile<CommandInfo>;
} {
  let savedProfile: Profile<CommandInfo> | undefined;
  const save = jest.fn((profile: Profile<CommandInfo>) => {
    savedProfile = profile;
    return Promise.resolve();
  });
  const collectAll = jest.fn(() => Promise.resolve());
  const registerEntrypointType = jest.fn();
  const core = {
    storage: { save, crossProcess },
    collectorRegistry: { collectAll },
    registerEntrypointType,
  } as unknown as ProfilerCoreService;
  return {
    core,
    save,
    collectAll,
    registerEntrypointType,
    saved: () => savedProfile as Profile<CommandInfo>,
  };
}

const META = { name: 'sync:posts', arguments: ['--limit', '5'], options: { dryRun: true } };

describe('CommandProfiler', () => {
  it('registers the command entrypoint type on module init', () => {
    const { cls } = createCls();
    const { core, registerEntrypointType } = createCore();
    new CommandProfiler(cls, core).onModuleInit();
    expect(registerEntrypointType).toHaveBeenCalledWith(COMMAND_ENTRYPOINT_TYPE_DEF);
  });

  it('profiles a successful command and saves the profile', async () => {
    const { cls, set } = createCls();
    const { core, save, collectAll, saved } = createCore();
    const profiler = new CommandProfiler(cls, core);
    const exec = jest.fn().mockResolvedValue(undefined);

    await profiler.profile(META, exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('profiler.token', expect.any(String));
    expect(set).toHaveBeenCalledWith('profiler.profile', expect.any(Object));

    const profile = saved();
    expect(profile.entrypoint.type).toBe(COMMAND_ENTRYPOINT_TYPE);
    expect(profile.entrypoint.data).toMatchObject({
      name: 'sync:posts',
      arguments: ['--limit', '5'],
      options: { dryRun: true },
      exitCode: 0,
      success: true,
    });
    expect(profile.response?.statusCode).toBe(200);
    expect(profile.exceptions).toHaveLength(0);
    expect(profile.performance.duration).toBeGreaterThanOrEqual(0);

    // collectors run before the profile is persisted
    expect(collectAll).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const [collectOrder] = collectAll.mock.invocationCallOrder;
    const [saveOrder] = save.mock.invocationCallOrder;
    if (collectOrder === undefined || saveOrder === undefined) {
      throw new Error('expected both collectAll and save to have been called');
    }
    expect(collectOrder).toBeLessThan(saveOrder);
  });

  it('captures the exception, marks the profile failed, and rethrows', async () => {
    const { cls } = createCls();
    const { core, save, collectAll, saved } = createCore();
    const profiler = new CommandProfiler(cls, core);
    const boom = new Error('boom');
    const exec = jest.fn().mockRejectedValue(boom);

    await expect(profiler.profile(META, exec)).rejects.toThrow('boom');

    const profile = saved();
    expect(profile.response?.statusCode).toBe(500);
    expect(profile.entrypoint.data).toMatchObject({ exitCode: 1, success: false });
    expect(profile.exceptions).toHaveLength(1);
    expect(profile.exceptions[0]).toMatchObject({ name: 'Error', message: 'boom' });

    // even on failure, collectors run and the profile is saved
    expect(collectAll).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('wraps non-Error throws', async () => {
    const { cls } = createCls();
    const { core, saved } = createCore();
    const profiler = new CommandProfiler(cls, core);
    const exec = jest.fn().mockRejectedValue('string failure');

    await expect(profiler.profile(META, exec)).rejects.toThrow('string failure');

    const profile = saved();
    expect(profile.entrypoint.data).toMatchObject({ success: false });
    expect(profile.exceptions[0]).toMatchObject({ message: 'string failure' });
  });

  it('records the command name and empty arguments when none are passed', async () => {
    const { cls } = createCls();
    const { core, saved } = createCore();
    const profiler = new CommandProfiler(cls, core);

    await profiler.profile({ name: 'demo:greet', arguments: [], options: {} }, jest.fn());

    expect(saved().entrypoint.data).toMatchObject({
      name: 'demo:greet',
      arguments: [],
    });
  });

  it('warns once when commands are profiled to a process-local store', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { cls } = createCls();
      const { core } = createCore(false); // in-memory / process-local
      const profiler = new CommandProfiler(cls, core);

      await profiler.profile(META, jest.fn());
      await profiler.profile(META, jest.fn());

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('in-memory'));
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when storage is cross-process', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { cls } = createCls();
      const { core } = createCore(true);
      const profiler = new CommandProfiler(cls, core);

      await profiler.profile(META, jest.fn());

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
