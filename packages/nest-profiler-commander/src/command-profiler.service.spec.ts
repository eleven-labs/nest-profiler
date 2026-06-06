import { Logger } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import type { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { CommandProfiler } from './command-profiler.service';

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
  saved: () => Profile;
} {
  let savedProfile: Profile | undefined;
  const save = jest.fn((profile: Profile) => {
    savedProfile = profile;
    return Promise.resolve();
  });
  const collectAll = jest.fn(() => Promise.resolve());
  const core = {
    storage: { save, crossProcess },
    collectorRegistry: { collectAll },
  } as unknown as ProfilerCoreService;
  return { core, save, collectAll, saved: () => savedProfile as Profile };
}

const META = { name: 'sync:posts', arguments: ['--limit', '5'], options: { dryRun: true } };

describe('CommandProfiler', () => {
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
    expect(profile.request.method).toBe('CLI');
    expect(profile.request.url).toBe('sync:posts --limit 5');
    expect(profile.request.command).toMatchObject({
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
    expect(profile.request.command).toMatchObject({ exitCode: 1, success: false });
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
    expect(profile.request.command).toMatchObject({ success: false });
    expect(profile.exceptions[0]).toMatchObject({ message: 'string failure' });
  });

  it('builds the url from the command name only when there are no arguments', async () => {
    const { cls } = createCls();
    const { core, saved } = createCore();
    const profiler = new CommandProfiler(cls, core);

    await profiler.profile({ name: 'demo:greet', arguments: [], options: {} }, jest.fn());

    expect(saved().request.url).toBe('demo:greet');
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
