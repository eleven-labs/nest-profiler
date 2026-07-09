import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CollectorRegistry } from './collector-registry.service';
import { DiscoveryModule } from '@nestjs/core';
import { ProfilerCollector } from './collector.decorator';
import type { IProfilerCollector } from './collector.interface';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';

// Collectors discovered through the @ProfilerCollector decorator carry their
// presentation metadata on the decorator (not on the instance), exercising the
// `meta.* ?? instance.*` resolution branches in the registry.
@Injectable()
@ProfilerCollector({ name: 'deco', label: 'Decorated', icon: '<i/>', priority: 3 })
class DecoratedCollector implements IProfilerCollector {
  readonly name = 'deco';
  collect(): { ok: boolean } {
    return { ok: true };
  }
  getBadgeValue(): string {
    return '1';
  }
  getTemplatePath(): string {
    return '/deco.ejs';
  }
}

@Injectable()
@ProfilerCollector({
  name: 'sql',
  label: 'SQL',
  group: 'database',
  groupLabel: 'Database',
  groupIcon: '<g/>',
  groupPriority: 15,
  priority: 40,
})
class DecoratedGroupedCollector implements IProfilerCollector {
  readonly name = 'sql';
  collect(): unknown[] {
    return [];
  }
  getBadgeValue(): string {
    return '2';
  }
}

@Injectable()
@ProfilerCollector({ name: 'app-metrics', label: 'Metrics', scope: 'global' })
class DecoratedGlobalCollector implements IProfilerCollector {
  readonly name = 'app-metrics';
  collect(): { count: number } {
    return { count: 3 };
  }
}

// The decorator carries only the name; all presentation metadata lives on the
// instance, exercising the `meta.* ?? instance.*` *instance* fallback branches.
@Injectable()
@ProfilerCollector({ name: 'inst-plain' })
class InstanceMetadataCollector implements IProfilerCollector {
  readonly name = 'inst-plain';
  readonly label = 'InstLabel';
  readonly icon = '<ii/>';
  readonly priority = 7;
  collect(): unknown {
    return {};
  }
  getBadgeValue(): string {
    return 'b';
  }
  getTemplatePath(): string {
    return '/inst.ejs';
  }
}

@Injectable()
@ProfilerCollector({ name: 'inst-grp-1' })
class InstanceGroupedOne implements IProfilerCollector {
  readonly name = 'inst-grp-1';
  readonly label = 'GrpOne';
  readonly group = 'instgrp';
  readonly groupLabel = 'InstGroup';
  readonly groupIcon = '<gi/>';
  readonly groupPriority = 12;
  collect(): unknown[] {
    return [];
  }
  getBadgeValue(): string {
    return '4';
  }
}

@Injectable()
@ProfilerCollector({ name: 'inst-grp-2' })
class InstanceGroupedTwo implements IProfilerCollector {
  readonly name = 'inst-grp-2';
  readonly group = 'instgrp';
  collect(): unknown[] {
    return [];
  }
  getBadgeValue(): string {
    return '5';
  }
}

@Injectable()
@ProfilerCollector({ name: 'inst-global' })
class InstanceGlobalCollector implements IProfilerCollector {
  readonly name = 'inst-global';
  readonly label = 'InstGlobal';
  readonly scope = 'global';
  collect(): unknown {
    return { n: 1 };
  }
}

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('CollectorRegistry', () => {
  let registry: CollectorRegistry;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [CollectorRegistry],
    }).compile();
    registry = module.get(CollectorRegistry);
    await module.init();
  });

  it('manually registered collector is called in collectAll', async () => {
    const collectMock = jest.fn().mockReturnValue({ foo: 'bar' });
    const collector: IProfilerCollector = { name: 'test', collect: collectMock };
    registry.register(collector);
    const profile = makeProfile();
    await registry.collectAll(profile);
    expect(collectMock).toHaveBeenCalledWith(profile);
    expect(profile.collectors['test']).toEqual({ foo: 'bar' });
  });

  it('isolates collector errors, stores the real message and logs a warning', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const collector: IProfilerCollector = {
      name: 'broken',
      collect: jest.fn().mockRejectedValue(new Error('boom')),
    };
    registry.register(collector);
    const profile = makeProfile();
    await expect(registry.collectAll(profile)).resolves.not.toThrow();
    expect(profile.collectors['broken']).toEqual({ error: 'boom' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken'));
    warn.mockRestore();
  });

  it('isolates errors from non-Error throws by stringifying them', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    registry.register({
      name: 'throws-string',
      collect: jest.fn().mockRejectedValue('plain failure'),
    });
    const profile = makeProfile();
    await registry.collectAll(profile);
    expect(profile.collectors['throws-string']).toEqual({ error: 'plain failure' });
    warn.mockRestore();
  });

  it('buildGlobalPanels isolates a throwing global collector instead of bubbling up', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    registry.register({
      name: 'global-broken',
      scope: 'global',
      collect: jest.fn().mockRejectedValue(new Error('global boom')),
    });
    const panels = await registry.buildGlobalPanels();
    const panel = panels.find((p) => p.name === 'global-broken');
    expect(panel?.data).toEqual({ error: 'global boom' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('global-broken'));
    warn.mockRestore();
  });

  it('getCollectorNames returns registered names', () => {
    registry.register({ name: 'alpha', collect: () => ({}) });
    registry.register({ name: 'beta', collect: () => ({}) });
    expect(registry.getCollectorNames()).toContain('alpha');
    expect(registry.getCollectorNames()).toContain('beta');
  });

  it('buildPanels returns badgeValue from getBadgeValue', () => {
    const collector: IProfilerCollector = {
      name: 'widget',
      label: 'Widget',
      priority: 50,
      collect: () => [1, 2],
      getBadgeValue: (profile) => {
        const data = profile.collectors['widget'] as unknown[];
        return data?.length ? String(data.length) : null;
      },
      getTemplatePath: () => '/some/widget.ejs',
    };
    registry.register(collector);
    const profile = makeProfile();
    profile.collectors['widget'] = [1, 2]; // simulate post-collectAll state
    const panels = registry.buildPanels(profile);
    const panel = panels.find((p) => p.name === 'widget');
    expect(panel).toBeDefined();
    expect(panel?.badgeValue).toBe('2');
    expect(panel?.label).toBe('Widget');
    expect(panel?.templatePath).toBe('/some/widget.ejs');
  });

  it('buildPanels sets badgeValue to null for collector with no data', () => {
    registry.register({
      name: 'empty',
      label: 'Empty',
      priority: 10,
      collect: () => [],
      getBadgeValue: () => null,
    });
    const profile = makeProfile();
    const panels = registry.buildPanels(profile);
    const panel = panels.find((p) => p.name === 'empty');
    expect(panel?.badgeValue).toBeNull();
  });

  it('buildPanels orders panels by priority', () => {
    registry.register({ name: 'late', priority: 90, collect: () => ({}) });
    registry.register({ name: 'early', priority: 10, collect: () => ({}) });
    const names = registry.buildPanels(makeProfile()).map((p) => p.name);
    expect(names.indexOf('early')).toBeLessThan(names.indexOf('late'));
  });

  describe('grouped panels', () => {
    it('merges collectors sharing a group into a single group panel with sub-panels', () => {
      registry.register({
        name: 'sql',
        label: 'SQL',
        group: 'database',
        groupLabel: 'Database',
        groupIcon: '<svg/>',
        groupPriority: 20,
        collect: () => [],
        getBadgeValue: () => '5',
      });
      registry.register({
        name: 'mongo',
        label: 'Mongo',
        group: 'database',
        collect: () => [],
        getBadgeValue: () => '3',
      });

      const panels = registry.buildPanels(makeProfile());
      const group = panels.find((p) => p.name === 'database');
      expect(group?.isGroup).toBe(true);
      expect(group?.label).toBe('Database');
      expect(group?.priority).toBe(20);
      expect(group?.subPanels?.map((s) => s.name)).toEqual(['sql', 'mongo']);
      // Badge values from each sub-collector are concatenated.
      expect(group?.badgeValue).toBe('5 · 3');
    });

    it('merges three database collectors (typeorm + mikro-orm + mongoose) into one group', () => {
      // Mirrors an app wiring several ORMs at once: every query collector shares the
      // `database` group, so all of them must surface as distinct, labelled sub-panels
      // under a single "Database" panel with a concatenated badge — no query is dropped.
      registry.register({
        name: 'typeorm',
        label: 'TypeORM',
        group: 'database',
        groupLabel: 'Database',
        groupPriority: 10,
        collect: () => [],
        getBadgeValue: () => '2q',
      });
      registry.register({
        name: 'mikro-orm',
        label: 'MikroORM',
        group: 'database',
        collect: () => [],
        getBadgeValue: () => '4q (1 slow)',
      });
      registry.register({
        name: 'mongoose',
        label: 'MongoDB',
        group: 'database',
        collect: () => [],
        getBadgeValue: () => '3q',
      });

      const group = registry.buildPanels(makeProfile()).find((p) => p.name === 'database');
      expect(group?.isGroup).toBe(true);
      expect(group?.subPanels?.map((s) => s.name)).toEqual(['typeorm', 'mikro-orm', 'mongoose']);
      expect(group?.subPanels?.map((s) => s.label)).toEqual(['TypeORM', 'MikroORM', 'MongoDB']);
      expect(group?.badgeValue).toBe('2q · 4q (1 slow) · 3q');
    });

    it('propagates the worst sub-panel severity onto the group tab', () => {
      registry.register({
        name: 'typeorm',
        label: 'TypeORM',
        group: 'database',
        groupLabel: 'Database',
        collect: () => [],
        getBadgeValue: () => '2q',
        getBadgeSeverity: () => 'warning',
      });
      registry.register({
        name: 'mongoose',
        label: 'MongoDB',
        group: 'database',
        collect: () => [],
        getBadgeValue: () => '3q',
        getBadgeSeverity: () => 'danger',
      });

      const group = registry.buildPanels(makeProfile()).find((p) => p.name === 'database');
      expect(group?.severity).toBe('danger');
    });

    it('exposes a non-grouped collector severity on its own panel', () => {
      registry.register({
        name: 'http-client',
        label: 'HTTP Client',
        collect: () => [],
        getBadgeValue: () => '5',
        getBadgeSeverity: () => 'warning',
      });
      const panel = registry.buildPanels(makeProfile()).find((p) => p.name === 'http-client');
      expect(panel?.severity).toBe('warning');
    });

    it('derives group label/priority from minimal metadata and a deferred badge', () => {
      // First collector has no badge (group badge starts undefined); the group label
      // and priority fall back to the group name and the collector priority respectively.
      registry.register({ name: 'g-first', group: 'mini', priority: 30, collect: () => [] });
      // Second collector supplies the first non-null badge for the group.
      registry.register({
        name: 'g-second',
        group: 'mini',
        priority: 31,
        collect: () => [],
        getBadgeValue: () => '9',
      });

      const group = registry.buildPanels(makeProfile()).find((p) => p.name === 'mini');
      expect(group?.label).toBe('mini');
      expect(group?.priority).toBe(30);
      expect(group?.badgeValue).toBe('9');
      expect(group?.subPanels).toHaveLength(2);
    });

    it('keeps a badgeless group active (badgeValue undefined, not null) so it is never dimmed', () => {
      // No collector in the group exposes a counter, yet the group carries content:
      // its badgeValue must stay undefined so the sidebar renders it active.
      registry.register({ name: 'a', group: 'plain', priority: 10, collect: () => [] });
      registry.register({ name: 'b', group: 'plain', priority: 11, collect: () => [] });
      const group = registry.buildPanels(makeProfile()).find((p) => p.name === 'plain');
      expect(group?.isGroup).toBe(true);
      expect(group?.subPanels).toHaveLength(2);
      expect(group?.badgeValue).toBeUndefined();
    });

    it('skips grouped collectors whose badge value is null', () => {
      registry.register({
        name: 'hidden',
        group: 'misc',
        collect: () => [],
        getBadgeValue: () => null,
      });
      const panels = registry.buildPanels(makeProfile());
      expect(panels.find((p) => p.name === 'misc')).toBeUndefined();
    });
  });

  describe('scope handling', () => {
    it('collectAll ignores global-scope collectors', async () => {
      const globalCollect = jest.fn().mockReturnValue({ g: 1 });
      registry.register({ name: 'request-c', collect: () => ({ r: 1 }) });
      registry.register({ name: 'global-c', scope: 'global', collect: globalCollect });

      const profile = makeProfile();
      await registry.collectAll(profile);

      expect(profile.collectors['request-c']).toEqual({ r: 1 });
      expect(profile.collectors['global-c']).toBeUndefined();
      expect(globalCollect).not.toHaveBeenCalled();
    });

    it('buildGlobalPanels builds panels only for global-scope collectors', async () => {
      registry.register({ name: 'request-c', collect: () => ({}) });
      registry.register({
        name: 'metrics',
        label: 'Metrics',
        scope: 'global',
        collect: () => ({ count: 7 }),
        getTemplatePath: () => '/metrics.ejs',
      });

      const panels = await registry.buildGlobalPanels();
      expect(panels).toHaveLength(1);
      expect(panels[0]).toMatchObject({
        name: 'metrics',
        label: 'Metrics',
        data: { count: 7 },
        templatePath: '/metrics.ejs',
      });
    });
  });

  it('getCollectors returns the registered collector instances', () => {
    const a: IProfilerCollector = { name: 'a', collect: () => ({}) };
    registry.register(a);
    expect(registry.getCollectors()).toContain(a);
  });

  describe('collector timeout', () => {
    async function buildRegistry(options: ProfilerModuleOptions): Promise<CollectorRegistry> {
      const module = await Test.createTestingModule({
        imports: [DiscoveryModule],
        providers: [
          CollectorRegistry,
          { provide: NEST_PROFILER_MODULE_OPTIONS, useValue: options },
        ],
      }).compile();
      const reg = module.get(CollectorRegistry);
      await module.init();
      return reg;
    }

    it('abandons a hanging collector after the configured timeout', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const reg = await buildRegistry({ collectorTimeout: 20 });
      reg.register({ name: 'hangs', collect: () => new Promise<never>(() => undefined) });

      const profile = makeProfile();
      await reg.collectAll(profile);

      expect(profile.collectors['hangs']).toEqual({ error: 'timed out after 20ms' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('hangs'));
      warn.mockRestore();
    });

    it('does not time out a fast collector', async () => {
      const reg = await buildRegistry({ collectorTimeout: 1000 });
      reg.register({ name: 'fast', collect: () => ({ ok: true }) });
      const profile = makeProfile();
      await reg.collectAll(profile);
      expect(profile.collectors['fast']).toEqual({ ok: true });
    });

    it('disables the timeout when set to 0 (awaits even a slow collector)', async () => {
      const reg = await buildRegistry({ collectorTimeout: 0 });
      reg.register({
        name: 'slow',
        collect: () => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 30)),
      });
      const profile = makeProfile();
      await reg.collectAll(profile);
      expect(profile.collectors['slow']).toEqual({ done: true });
    });

    it('applies the timeout to global panels too', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const reg = await buildRegistry({ collectorTimeout: 20 });
      reg.register({
        name: 'slow-global',
        scope: 'global',
        collect: () => new Promise<never>(() => undefined),
      });

      const panels = await reg.buildGlobalPanels();
      const panel = panels.find((p) => p.name === 'slow-global');
      expect(panel?.data).toEqual({ error: 'timed out after 20ms' });
      warn.mockRestore();
    });
  });

  describe('decorator-driven discovery', () => {
    let discovered: CollectorRegistry;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        imports: [DiscoveryModule],
        providers: [
          CollectorRegistry,
          DecoratedCollector,
          DecoratedGroupedCollector,
          DecoratedGlobalCollector,
          InstanceMetadataCollector,
          InstanceGroupedOne,
          InstanceGroupedTwo,
          InstanceGlobalCollector,
        ],
      }).compile();
      discovered = module.get(CollectorRegistry);
      await module.init(); // triggers onModuleInit discovery
    });

    it('registers collectors annotated with @ProfilerCollector', () => {
      expect(discovered.getCollectorNames()).toEqual(
        expect.arrayContaining(['deco', 'sql', 'app-metrics']),
      );
    });

    it('builds panels using decorator metadata for label/icon/priority', () => {
      const panels = discovered.buildPanels(makeProfile());
      const deco = panels.find((p) => p.name === 'deco');
      expect(deco).toMatchObject({ label: 'Decorated', icon: '<i/>', priority: 3 });

      const group = panels.find((p) => p.name === 'database');
      expect(group).toMatchObject({ label: 'Database', icon: '<g/>', priority: 15, isGroup: true });
    });

    it('falls back to instance metadata when the decorator omits it', () => {
      const panels = discovered.buildPanels(makeProfile());

      const plain = panels.find((p) => p.name === 'inst-plain');
      expect(plain).toMatchObject({
        label: 'InstLabel',
        icon: '<ii/>',
        priority: 7,
        templatePath: '/inst.ejs',
      });

      // A group built purely from instance-level metadata, with two sub-panels
      // whose badge values are concatenated.
      const group = panels.find((p) => p.name === 'instgrp');
      expect(group).toMatchObject({
        label: 'InstGroup',
        icon: '<gi/>',
        priority: 12,
        isGroup: true,
        badgeValue: '4 · 5',
      });
      expect(group?.subPanels?.map((s) => s.name)).toEqual(['inst-grp-1', 'inst-grp-2']);
    });

    it('collectAll runs request-scoped decorated collectors only', async () => {
      const profile = makeProfile();
      await discovered.collectAll(profile);
      expect(profile.collectors['deco']).toEqual({ ok: true });
      expect(profile.collectors['app-metrics']).toBeUndefined();
    });

    it('buildGlobalPanels uses global-scoped collectors (decorator and instance metadata)', async () => {
      const panels = await discovered.buildGlobalPanels();
      expect(panels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'app-metrics', label: 'Metrics', data: { count: 3 } }),
          expect.objectContaining({ name: 'inst-global', label: 'InstGlobal', data: { n: 1 } }),
        ]),
      );
    });
  });
});
