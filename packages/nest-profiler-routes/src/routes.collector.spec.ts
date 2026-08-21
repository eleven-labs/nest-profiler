import { ModuleRef } from '@nestjs/core';
import type { Profile, ProfilerRouteSource, RouteGroup } from '@eleven-labs/nest-profiler';
import { discoverViewKey, RoutesCollector } from './routes.collector';

const EMPTY_PROFILE = {} as Profile;

function makeCollector(sources: ProfilerRouteSource[] | null): RoutesCollector {
  const moduleRef = {
    get: jest.fn(() => {
      if (sources === null) throw new Error('ProfilerCoreService not found');
      return { getRouteSources: () => sources };
    }),
  } as unknown as ModuleRef;
  return new RoutesCollector(moduleRef);
}

function source(type: string, groups: RouteGroup | RouteGroup[]): ProfilerRouteSource {
  return { type, collect: () => groups };
}

const healthRoute = {
  method: 'GET',
  path: '/health',
  controller: 'HealthController',
  handler: 'check',
};
const httpGroup: RouteGroup = { source: 'http', label: 'HTTP', routes: [healthRoute] };

describe('RoutesCollector', () => {
  it('is a global-scope panel exposing a template, filed under the Discover sidebar group', () => {
    const collector = makeCollector([]);
    expect(collector.scope).toBe('global');
    expect(collector.name).toBe('routes');
    expect(collector.group).toBe('discover');
    expect(collector.groupLabel).toBe('Discover');
    expect(collector.getTemplatePath()).toMatch(/routes-panel\.ejs$/);
  });

  describe('expandGlobalPanels', () => {
    const gqlGroup: RouteGroup = {
      source: 'graphql',
      label: 'GraphQL',
      itemLabel: 'field',
      routes: [
        { method: 'query', path: 'users', controller: 'UserResolver', handler: 'users' },
        { method: 'mutation', path: 'createUser', controller: 'UserResolver', handler: 'create' },
      ],
    };

    it('emits one view per transport, each carrying only its own group', () => {
      const collector = makeCollector([source('http', httpGroup), source('graphql', gqlGroup)]);
      const panels = collector.expandGlobalPanels(collector.collect(EMPTY_PROFILE));

      expect(panels).toEqual([
        {
          name: 'discover-http',
          label: 'HTTP',
          icon: collector.icon,
          data: { groups: [httpGroup], routeCount: 1 },
          badge: 1,
        },
        {
          name: 'discover-graphql',
          label: 'GraphQL',
          icon: collector.icon,
          data: { groups: [gqlGroup], routeCount: 2 },
          badge: 2,
        },
      ]);
    });

    it('keys a view so it can never collide with the same-protocol list section', () => {
      // `?view=graphql` stays the GraphQL profile list; the routing table is its own key.
      expect(discoverViewKey('graphql')).toBe('discover-graphql');
    });

    it('prefers the group icon over the collector default when the source ships one', () => {
      const iconGroup: RouteGroup = { ...httpGroup, icon: '<svg id="rest"/>' };
      const collector = makeCollector([source('http', iconGroup)]);
      expect(collector.expandGlobalPanels(collector.collect(EMPTY_PROFILE))[0]?.icon).toBe(
        '<svg id="rest"/>',
      );
    });

    it('emits no view at all when nothing was discovered, or when collection failed', () => {
      const collector = makeCollector([]);
      expect(collector.expandGlobalPanels(collector.collect(EMPTY_PROFILE))).toEqual([]);
      // `safeCollect` substitutes `{ error }` for a collector that threw — not a panel payload.
      expect(collector.expandGlobalPanels({ error: 'boom' })).toEqual([]);
      expect(collector.expandGlobalPanels(undefined)).toEqual([]);
    });
  });

  it('aggregates route groups from every registered source with a total count', () => {
    const gqlGroup: RouteGroup = {
      source: 'graphql',
      label: 'GraphQL',
      routes: [
        { method: 'query', path: 'users', controller: 'UserResolver', handler: 'users' },
        { method: 'mutation', path: 'createUser', controller: 'UserResolver', handler: 'create' },
      ],
    };
    const collector = makeCollector([source('http', httpGroup), source('graphql', gqlGroup)]);

    const data = collector.collect(EMPTY_PROFILE);
    expect(data.groups).toEqual([httpGroup, gqlGroup]);
    expect(data.routeCount).toBe(3);
  });

  it('lists HTTP first, then the other transports by label, whatever the registration order', () => {
    const gql: RouteGroup = { source: 'graphql', label: 'GraphQL', routes: [healthRoute] };
    const cli: RouteGroup = { source: 'command', label: 'Commands', routes: [healthRoute] };
    // Sources register in DI bootstrap order — here the built-in HTTP source registers last.
    const collector = makeCollector([
      source('graphql', gql),
      source('command', cli),
      source('http', httpGroup),
    ]);

    expect(collector.collect(EMPTY_PROFILE).groups.map((g) => g.label)).toEqual([
      'HTTP',
      'Commands',
      'GraphQL',
    ]);
  });

  it('flattens a source that returns multiple groups', () => {
    const a: RouteGroup = { source: 'a', label: 'A', routes: [healthRoute] };
    const b: RouteGroup = { source: 'b', label: 'B', routes: [healthRoute] };
    const collector = makeCollector([source('multi', [a, b])]);
    expect(collector.collect(EMPTY_PROFILE).groups).toEqual([a, b]);
  });

  it('skips empty groups and sources that throw', () => {
    const empty: RouteGroup = { source: 'empty', label: 'Empty', routes: [] };
    const throwing: ProfilerRouteSource = {
      type: 'boom',
      collect: () => {
        throw new Error('nope');
      },
    };
    const collector = makeCollector([source('empty', empty), throwing, source('http', httpGroup)]);

    const data = collector.collect(EMPTY_PROFILE);
    expect(data.groups).toEqual([httpGroup]);
    expect(data.routeCount).toBe(1);
  });

  it('returns an empty panel when the core is unavailable', () => {
    const collector = makeCollector(null);
    expect(collector.collect(EMPTY_PROFILE)).toEqual({ groups: [], routeCount: 0 });
  });

  it('resolves the core once and memoizes it across collect() calls', () => {
    const get = jest.fn(() => ({ getRouteSources: () => [source('http', httpGroup)] }));
    const collector = new RoutesCollector({ get } as unknown as ModuleRef);

    collector.collect(EMPTY_PROFILE);
    collector.collect(EMPTY_PROFILE);

    expect(get).toHaveBeenCalledTimes(1);
  });
});
